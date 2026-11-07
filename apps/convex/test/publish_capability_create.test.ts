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
  fixtureTemplate(TEMPLATE_ID, { missionTypes: [{ type: "make_image", publish: { kind: "image" } }] } as never),
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
});
