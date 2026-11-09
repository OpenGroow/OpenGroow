import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import { api } from "../_generated/api";
import schema from "../schema";
import { installPostiz } from "./postiz_fixture";
import { insertInstance } from "./instance_fixture";
import { fixtureTemplate, useTemplateRegistry } from "./helpers/template_registry.helpers";

// ADR-069 amendment: a channel whose platform cannot carry the Mission type's
// declared `publish.kind` is refused when a Mission or Schedule is created or
// edited; an uncertain one is allowed (the dashboard warns).

const modules = {
  "../_generated/api.ts": () => import("../_generated/api.js"),
  "../instances.ts": () => import("../instances.js"),
  "../missions.ts": () => import("../missions.js"),
  "../runs.ts": () => import("../runs.js"),
  "../schedules.ts": () => import("../schedules.js"),
  "../project_agents.ts": () => import("../project_agents.js"),
};

const INSTANCE_ID = "openclaw-capability";
const TEMPLATE_ID = "@test/image-maker";
const OWNER = { name: "Owner", email: "o@e.com", tokenIdentifier: "test|cap", subject: "cap-owner" };

useTemplateRegistry([INSTANCE_ID], [
  fixtureTemplate(TEMPLATE_ID, {
    missionTypes: [
      { type: "make_image", publish: { kind: "image" } },
      { type: "make_carousel", publish: { kind: "carousel", platforms: ["instagram", "tiktok"] } },
    ],
  } as never),
]);

async function seed() {
  const t = convexTest(schema, modules);
  await installPostiz(t);
  await t.run(async (ctx) => {
    const now = new Date().toISOString();
    await insertInstance(ctx, { jobId: "job-cap", status: "running", createdAt: now, openclawId: INSTANCE_ID, updatedAt: now, userId: OWNER.subject });
    await ctx.db.insert("publishers", {
      instanceId: INSTANCE_ID,
      adapter: "postiz",
      url: "https://postiz.example.com",
      targets: [
        { target: "youtube:yt", channelId: "c1", channelService: "youtube" },
        { target: "mastodon:m", channelId: "c2", channelService: "mastodon" },
        { target: "instagram:ig", channelId: "c3", channelService: "instagram" },
        { target: "pinterest:pin", channelId: "c4", channelService: "pinterest" },
      ],
      updatedAt: Date.now(),
    });
  });
  return t.withIdentity(OWNER);
}

const base = { instanceId: INSTANCE_ID, templateId: TEMPLATE_ID, type: "make_image" };
const DAILY = { unit: "daily" as const, hour: 9, minute: 0 };

describe("channel capabilities on creation and edit", () => {
  it("missions.create refuses a channel that cannot publish the kind", async () => {
    const owner = await seed();
    await expect(
      owner.mutation(api.missions.create, { ...base, payload: { publishTargets: ["youtube:yt"] } }),
    ).rejects.toThrow(/YouTube cannot publish an image/);
  });

  it("schedules.create and updatePayload refuse it, and allow an uncertain channel", async () => {
    const owner = await seed();
    const sched = { ...base, frequency: DAILY, timezone: "UTC" };
    await expect(
      owner.mutation(api.schedules.create, { ...sched, payload: { publishTargets: ["youtube:yt"] } }),
    ).rejects.toThrow(/YouTube cannot publish an image/);
    const { scheduleId } = await owner.mutation(api.schedules.create, { ...sched, payload: { publishTargets: ["mastodon:m"] } });
    await expect(
      owner.mutation(api.schedules.updatePayload, { scheduleId, payload: { publishTargets: ["youtube:yt"] } }),
    ).rejects.toThrow(/YouTube cannot publish an image/);
  });

  it("refuses a channel on a platform the Mission type does not publish to, and allows one it does", async () => {
    const owner = await seed();
    const carousel = { ...base, type: "make_carousel" };
    await expect(
      owner.mutation(api.missions.create, { ...carousel, payload: { publishTargets: ["pinterest:pin"] } }),
    ).rejects.toThrow(/publishes to Instagram and TikTok only/);
    // Past the channel checks the fixture has no active Agent, which is unrelated: only the platform check matters here.
    const failure = async (promise: Promise<unknown>) => {
      try {
        await promise;
        return "";
      } catch (error) {
        return String(error);
      }
    };
    expect(await failure(owner.mutation(api.missions.create, { ...carousel, payload: { publishTargets: ["instagram:ig"] } }))).not.toMatch(/publishes to/);
    // A Mission type that declares no platforms is open to every channel that can carry its kind.
    expect(await failure(owner.mutation(api.missions.create, { ...base, payload: { publishTargets: ["pinterest:pin"] } }))).not.toMatch(/publishes to/);
  });
});
