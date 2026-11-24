import { afterEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import type { Id } from "../_generated/dataModel";
import { api, internal } from "../_generated/api";
import schema from "../schema";
import { installPostiz } from "./postiz_fixture";
import { insertInstance } from "./instance_fixture";
import { fixtureTemplate, useTemplateRegistry } from "./helpers/template_registry.helpers";

vi.mock("../publisher/load_node.js", async () => (await import("./postiz_fixture")).postizLoaderModule);

// ADR-069 amendment: retry without duplicate posts. A POST /posts that may have
// reached Postiz leaves the Publication `uncertain`; a retry reconciles with
// Postiz before sending again. Public Convex functions only; Postiz is faked.

const modules = {
  "../_generated/api.ts": () => import("../_generated/api.js"),
  "../commands.ts": () => import("../commands.js"),
  "../events.ts": () => import("../events.js"),
  "../instances.ts": () => import("../instances.js"),
  "../missions.ts": () => import("../missions.js"),
  "../missions_node.ts": () => import("../missions_node.js"),
  "../publications.ts": () => import("../publications.js"),
  "../publication_polling.ts": () => import("../publication_polling.js"),
  "../publisher_node.ts": () => import("../publisher_node.js"),
  "../publishers.ts": () => import("../publishers.js"),
  "../runs.ts": () => import("../runs.js"),
  "../schedules.ts": () => import("../schedules.js"),
  "../project_agents.ts": () => import("../project_agents.js"),
};

const INSTANCE_ID = "openclaw-pub-runref";
const TEMPLATE_ID = "@test/image-maker";
const OWNER = { name: "Owner", email: "o@e.com", tokenIdentifier: "test|runref", subject: "runref-owner" };
const OTHER = { name: "Other", email: "x@e.com", tokenIdentifier: "test|runref-x", subject: "runref-other" };

const imageTemplate = fixtureTemplate(TEMPLATE_ID, {
  missionTypes: [
    {
      type: "make_image",
      publish: { kind: "image" },
      review: {
        kind: "image",
        service: "workspace",
        actions: [
          { key: "approve", label: "Approve", requiredStatus: "to_validate", transition: "approved" },
          { key: "publish", label: "Publish", requiredStatus: "approved", transition: "done" },
        ],
      },
    },
  ],
} as never);
const plainTemplate = fixtureTemplate("@test/plain", {
  missionTypes: [
    {
      type: "make_plain",
      review: {
        kind: "image",
        service: "workspace",
        actions: [{ key: "publish", label: "Publish", requiredStatus: "approved", transition: "done" }],
      },
    },
  ],
} as never);
useTemplateRegistry([INSTANCE_ID], [imageTemplate, plainTemplate]);

const PUBLISHABLE = { kind: "image", imageUrl: "https://cdn.example.com/i.png", caption: "Hello world" };

async function seed(opts: { map?: boolean } = {}) {
  const t = convexTest(schema, modules);
  await installPostiz(t);
  await t.run(async (ctx) => {
    const now = new Date().toISOString();
    await insertInstance(ctx, {
      jobId: `job-${INSTANCE_ID}`,
      status: "running",
      createdAt: now,
      openclawId: INSTANCE_ID,
      updatedAt: now,
      userId: OWNER.subject,
    });
  });
  const owner = t.withIdentity(OWNER);
  await owner.mutation(api.publishers.save, {
    instanceId: INSTANCE_ID,
    adapter: "postiz",
    url: "https://postiz.example.com",
    apiKey: "secret",
  });
  if (opts.map !== false) {
    await owner.mutation(api.publishers.addChannel, {
      adapter: "postiz",
      instanceId: INSTANCE_ID,
      channelId: "ch-1",
      channelName: "My IG",
      channelService: "instagram",
      channelProfile: "love_youmake",
    });
  }
  const missionId = await t.run(async (ctx) => {
    const now = Date.now();
    return ctx.db.insert("missions", {
      ownerId: OWNER.subject,
      instanceId: INSTANCE_ID,
      templateId: TEMPLATE_ID,
      type: "make_image",
      payload: { publishTargets: ["instagram:love_youmake"] },
      status: "doing",
      createdAt: now,
      updatedAt: now,
    } as never);
  });
  return { t, owner, missionId };
}

type Seeded = Awaited<ReturnType<typeof seed>>;

async function newRun(s: Seeded): Promise<Id<"runs">> {
  return s.t.run(async (ctx) => {
    const now = Date.now();
    return ctx.db.insert("runs", {
      missionId: s.missionId,
      ownerId: OWNER.subject,
      instanceId: INSTANCE_ID,
      templateId: TEMPLATE_ID,
      agentName: "agent",
      sessionKey: `sk-${now}-${Math.random()}`,
      status: "running",
      createdAt: now,
      updatedAt: now,
    } as never);
  });
}

const artifact = (caption: string) => ({
  external: { service: "media", id: "42" },
  publishable: { kind: "image", imageUrl: "https://cdn.example.com/i.png", caption },
});

/** A Run that produced an output for review. */
async function produce(s: Seeded, caption: string): Promise<Id<"runs">> {
  const runId = await newRun(s);
  await s.t.mutation(internal.runs.markCompleted, {
    runId,
    result: { status: "needs_human_review", summary: "Ready", reviewQuestions: [], artifact: artifact(caption) } as never,
  });
  return runId;
}

async function fail(s: Seeded): Promise<Id<"runs">> {
  const runId = await newRun(s);
  await s.t.mutation(internal.runs.markCompleted, {
    runId,
    result: { status: "failed", summary: "Nope", error: { code: "x", message: "boom" } } as never,
  });
  return runId;
}

const approve = (s: Seeded) =>
  s.t.run(async (ctx) => ctx.db.patch(s.missionId, { status: "approved" }));
const begin = (s: Seeded) => s.t.mutation(internal.publications.beginAll, { missionId: s.missionId });
const publicationRunId = async (s: Seeded) =>
  s.t.run(async (ctx) => (await ctx.db.query("publications").first())?.runId ?? "none");
const markFailed = (s: Seeded) =>
  s.t.run(async (ctx) => {
    const p = (await ctx.db.query("publications").first())!;
    await ctx.db.patch(p._id, { status: "failed" });
  });

describe("a Publication references the Run of its approved output", () => {
  it("records the Run that produced the output on the Mission, then on the Publication", async () => {
    const s = await seed();
    const run = await produce(s, "v1");
    await approve(s);
    await begin(s);
    expect(await publicationRunId(s)).toBe(run);
  });

  it("is not changed by a later Run that failed before publication", async () => {
    const s = await seed();
    const run = await produce(s, "v1");
    await approve(s);
    await fail(s);
    await approve(s);
    await begin(s);
    expect(await publicationRunId(s)).toBe(run);
  });

  it("keeps the Run on a retry whose output did not change", async () => {
    const s = await seed();
    const run = await produce(s, "v1");
    await approve(s);
    await begin(s);
    await markFailed(s);
    await begin(s);
    expect(await publicationRunId(s)).toBe(run);
  });

  it("takes the new Run on a retry whose output changed", async () => {
    const s = await seed();
    await produce(s, "v1");
    await approve(s);
    await begin(s);
    await markFailed(s);
    const second = await produce(s, "v2");
    await approve(s);
    await begin(s);
    expect(await publicationRunId(s)).toBe(second);
  });

  it("leaves Missions and Publications created before it without a Run", async () => {
    const s = await seed();
    await s.t.run(async (ctx) =>
      ctx.db.patch(s.missionId, {
        status: "approved",
        lastResult: { status: "needs_human_review", summary: "Ready", reviewQuestions: [], artifact: artifact("old") } as never,
      }),
    );
    expect((await s.t.run(async (ctx) => ctx.db.get(s.missionId)))?.lastResultRunId ?? null).toBeNull();
    await begin(s);
    expect(await publicationRunId(s)).toBe("none");
  });
});
