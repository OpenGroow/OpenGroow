import { insertInstance } from "./instance_fixture";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import { api, internal } from "../_generated/api";
import schema from "../schema";
import type { Doc, Id } from "../_generated/dataModel";
import {
  readHostedClawPackageFixture,
  withFile,
  type PackageFile,
} from "../../../packages/agent-templates/src/__fixtures__/claw-package";

// Pinning of Missions to the Template version they were created with (#651):
// the real Project registry (installed packages), no in-memory override.
const modules = {
  "../_generated/api.ts": () => import("../_generated/api.js"),
  "../commands.ts": () => import("../commands.js"),
  "../commands_node.ts": () => import("../commands_node.js"),
  "../connect_tickets.ts": () => import("../connect_tickets.js"),
  "../connect_tickets_node.ts": () => import("../connect_tickets_node.js"),
  "../events.ts": () => import("../events.js"),
  "../health.ts": () => import("../health.js"),
  "../http.ts": () => import("../http.js"),
  "../instances.ts": () => import("../instances.js"),
  "../instances_node.ts": () => import("../instances_node.js"),
  "../missions.ts": () => import("../missions.js"),
  "../missions_node.ts": () => import("../missions_node.js"),
  "../runs.ts": () => import("../runs.js"),
  "../project_agents.ts": () => import("../project_agents.js"),
  "../project_agents_node.ts": () => import("../project_agents_node.js"),
  "../project_templates.ts": () => import("../project_templates.js"),
  "../template_mcp_overrides.ts": () => import("../template_mcp_overrides.js"),
  "../runtime_commands_node.ts": () => import("../runtime_commands_node.js"),
  "../mission_dispatcher.ts": () => import("../mission_dispatcher.js"),
  "../mission_dispatcher_node.ts": () => import("../mission_dispatcher_node.js"),
};

const PROJECT = "openclaw-project-pin";
const OWNER = { name: "Owner", email: "o@e.com", tokenIdentifier: "test|pin", subject: "owner-pin" };

const seoV1 = (): PackageFile[] => readHostedClawPackageFixture("seo");

/** v2 renames the approve endpoint and the article status polling tool of v1. */
function seoV2(): PackageFile[] {
  const profile = seoV1().find((f) => f.path === "profiles/opengroow.yml")!.content;
  const changed = profile
    .replace("/articles/{id}/approve", "/articles/{id}/accept")
    .replace("label: Approve", "label: Accept")
    .replace("mcpTool: get_article_status", "mcpTool: get_article_status_v2");
  expect(changed).not.toBe(profile);
  return withFile(
    withFile(seoV1(), "profiles/opengroow.yml", changed),
    "package.json",
    JSON.stringify({ name: "@acme/seo", version: "0.0.2", openclaw: { claw: "CLAW.md" } }),
  );
}

async function seedInstance(t: ReturnType<typeof convexTest>, openclawId: string) {
  const now = new Date().toISOString();
  await t.run(async (ctx) => {
    await insertInstance(ctx, {
      jobId: `job-${openclawId}`,
      status: "running",
      runtimeStatus: "linked",
      runtimeReady: true,
      createdAt: now,
      openclawId,
      updatedAt: now,
      userId: OWNER.subject,
    });
  });
}

const missionDoc = (t: ReturnType<typeof convexTest>, id: Id<"missions">) =>
  t.run(async (ctx) => (await ctx.db.get(id)) as Doc<"missions">);

describe("Missions pinned to their Template version (#651)", () => {
  let t: ReturnType<typeof convexTest>;
  let as: ReturnType<ReturnType<typeof convexTest>["withIdentity"]>;

  beforeEach(async () => {
    t = convexTest(schema, modules);
    await seedInstance(t, PROJECT);
    const ts = Date.now();
    await t.run(async (ctx) => {
      await ctx.db.insert("projectAgents", {
        instanceId: PROJECT,
        templateId: "@acme/seo",
        status: "active",
        workspaceKey: "ws-pin",
        openclawAgentName: "seo",
        mcpServerKeys: [],
        config: { seoProjectId: "proj-pin", apiKey: "key-pin" },
        createdAt: ts,
        updatedAt: ts,
      });
    });
    as = t.withIdentity(OWNER);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const install = (files: PackageFile[]) => as.mutation(api.project_templates.install, { projectId: PROJECT, files });
  const createMission = async (instanceId = PROJECT) =>
    (
      await as.mutation(api.missions.create, {
        instanceId,
        templateId: "@acme/seo",
        type: "create_article",
        payload: { keyword: "octopus" },
      })
    ).missionId;
  const toValidate = (missionId: Id<"missions">) =>
    t.run(async (ctx) => {
      await ctx.db.patch(missionId, {
        status: "to_validate",
        lastResult: {
          status: "needs_human_review",
          summary: "ready",
          reviewQuestions: [],
          artifact: { kind: "markdown", external: { service: "article-mcp", id: "art-1" }, metadata: {} },
        } as Doc<"missions">["lastResult"],
      });
    });

  it("records the installed version at creation, and no version when the Template is not installed", async () => {
    await install(seoV1());
    expect((await missionDoc(t, await createMission())).templateVersion).toBe("0.0.1");

    // A Project with nothing installed has no version to pin (no compiled-in fallback, #674).
    await seedInstance(t, "openclaw-project-builtin");
    await t.run(async (ctx) => {
      const agent = (await ctx.db.query("projectAgents").collect())[0]!;
      const { _id, _creationTime, ...rest } = agent;
      await ctx.db.insert("projectAgents", { ...rest, instanceId: "openclaw-project-builtin" });
    });
    const notInstalled = await createMission("openclaw-project-builtin");
    expect((await missionDoc(t, notInstalled)).templateVersion).toBeUndefined();
  });

  it("a Template update while a Mission is in to_validate leaves it with its original review actions", async () => {
    await install(seoV1());
    const missionId = await createMission();
    await toValidate(missionId);

    await install(seoV2());

    const review = await as.action(api.missions_node.getReview, { missionId });
    expect(review.actions.find((a) => a.key === "approve")?.label).toBe("Approve");

    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (url: string) => {
        calls.push(String(url));
        return { ok: true, status: 200, statusText: "OK", json: async () => ({}) };
      }),
    );
    await as.action(api.missions_node.performReviewAction, { missionId, actionKey: "approve" });
    expect(calls.some((u) => u.includes("/articles/art-1/approve"))).toBe(true);
    expect(calls.some((u) => u.includes("/accept"))).toBe(false);

    // A Mission created after the update runs the new version.
    const fresh = await createMission();
    expect((await missionDoc(t, fresh)).templateVersion).toBe("0.0.2");
    await toValidate(fresh);
    const freshReview = await as.action(api.missions_node.getReview, { missionId: fresh });
    expect(freshReview.actions.find((a) => a.key === "approve")?.label).toBe("Accept");
  });

  it("a Mission created before versions existed follows the Project's current installed version", async () => {
    await install(seoV2());
    const missionId = await createMission();
    await toValidate(missionId);
    await t.run(async (ctx) => ctx.db.patch(missionId, { templateVersion: undefined }));

    const review = await as.action(api.missions_node.getReview, { missionId });
    expect(review.actions.find((a) => a.key === "approve")?.label).toBe("Accept");
  });

  it("polls an in-flight external job with the contract of the Mission's version", async () => {
    await install(seoV1());
    const missionId = await createMission();
    await t.run(async (ctx) => {
      const run = (await ctx.db.query("runs").collect()).find((r) => r.missionId === missionId)!;
      await ctx.db.patch(missionId, { status: "doing" });
      await ctx.db.patch(run._id, {
        status: "awaiting_job",
        mcpJob: {
          serverName: "article-mcp",
          jobId: "job-1",
          summary: "Generating",
          reviewQuestions: [],
          jobType: "generate_article",
          missionType: "create_article",
        },
        dispatchedAt: Date.now(),
      });
    });
    await install(seoV2());

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      headers: { get: () => "application/json" },
      json: async () => ({
        result: { content: [{ type: "text", text: JSON.stringify({ status: "running" }) }], isError: false },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await t.action(internal.mission_dispatcher_node.pollExternalJobs, {});

    expect(fetchMock).toHaveBeenCalledOnce();
    const init = (fetchMock.mock.calls[0] as [string, RequestInit])[1];
    const body = JSON.parse(init.body as string) as { params: { name: string } };
    expect(body.params.name).toBe("get_article_status");
  });

  it("keeps a superseded version while an unfinished Mission uses it, and flags it removable afterwards", async () => {
    await install(seoV1());
    const missionId = await createMission();
    await install(seoV2());

    const usage = () => as.query(api.project_templates.versionUsage, { projectId: PROJECT, templateId: "@acme/seo" });
    expect(await usage()).toEqual(
      expect.arrayContaining([
        { version: "0.0.1", current: false, inUse: true, removable: false },
        { version: "0.0.2", current: true, inUse: false, removable: false },
      ]),
    );
    // Still stored.
    expect(
      await t.run(async (ctx) => (await ctx.db.query("installedTemplates").collect()).map((d) => d.version).sort()),
    ).toEqual(["0.0.1", "0.0.2"]);

    await t.run(async (ctx) => ctx.db.patch(missionId, { status: "done" }));
    expect(await usage()).toEqual(
      expect.arrayContaining([{ version: "0.0.1", current: false, inUse: false, removable: true }]),
    );
  });
});

// The public install is self-host only (#707): these tests install packages the way a self-hosted owner does.
beforeEach(() => {
  vi.stubEnv("IS_SELF_HOST", "1");
});
afterEach(() => {
  vi.unstubAllEnvs();
});
