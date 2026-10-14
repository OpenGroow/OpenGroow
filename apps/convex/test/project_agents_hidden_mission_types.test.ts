import { insertInstance } from "./instance_fixture";
import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import { api, internal } from "../_generated/api";
import schema from "../schema";

const modules = {
  "../_generated/api.ts": () => import("../_generated/api.js"),
  "../instances.ts": () => import("../instances.js"),
  "../jobs.ts": () => import("../jobs.js"),
  "../project_agents.ts": () => import("../project_agents.js"),
};

const INSTANCE = "instance-hidden-types";
const TEMPLATE = "video-demo";
const OWNER = { name: "Owner", email: "owner@example.com", tokenIdentifier: "test|owner", subject: "owner" };
const STRANGER = { name: "Other", email: "other@example.com", tokenIdentifier: "test|other", subject: "other" };
const NOW = "2026-10-01T00:00:00.000Z";

async function seedActiveAgent(t: ReturnType<typeof convexTest>) {
  await t.run((ctx) =>
    insertInstance(ctx, {
      jobId: "provisioning-job",
      status: "running",
      runtimeStatus: "linked",
      runtimeReady: true,
      createdAt: NOW,
      openclawId: INSTANCE,
      updatedAt: NOW,
      userId: OWNER.subject,
    }),
  );
  await t.mutation(internal.project_agents.upsert, {
    instanceId: INSTANCE,
    templateId: TEMPLATE,
    status: "active",
    workspaceKey: "workspace-hidden",
    openclawAgentName: TEMPLATE,
  });
}

async function agentFor(t: ReturnType<typeof convexTest>, identity: typeof OWNER) {
  const agents = await t.withIdentity(identity).query(api.project_agents.listByInstance, { instanceId: INSTANCE });
  return agents.find((a) => a.templateId === TEMPLATE);
}

describe("setHiddenMissionTypes (ADR-053)", () => {
  it("shows every Mission type until the operator hides some", async () => {
    const t = convexTest(schema, modules);
    await seedActiveAgent(t);
    expect((await agentFor(t, OWNER))?.hiddenMissionTypes).toBeUndefined();
  });

  it("stores the hidden Mission types the operator chose and returns them with the Agent", async () => {
    const t = convexTest(schema, modules);
    await seedActiveAgent(t);
    await t.withIdentity(OWNER).mutation(api.project_agents.setHiddenMissionTypes, {
      instanceId: INSTANCE,
      templateId: TEMPLATE,
      hiddenMissionTypes: ["create_chat_mock_video"],
    });
    expect((await agentFor(t, OWNER))?.hiddenMissionTypes).toEqual(["create_chat_mock_video"]);
  });

  it("un-hides every type when given an empty list", async () => {
    const t = convexTest(schema, modules);
    await seedActiveAgent(t);
    const args = { instanceId: INSTANCE, templateId: TEMPLATE };
    await t.withIdentity(OWNER).mutation(api.project_agents.setHiddenMissionTypes, {
      ...args,
      hiddenMissionTypes: ["create_chat_mock_video"],
    });
    await t.withIdentity(OWNER).mutation(api.project_agents.setHiddenMissionTypes, { ...args, hiddenMissionTypes: [] });
    expect((await agentFor(t, OWNER))?.hiddenMissionTypes ?? []).toEqual([]);
  });

  it("refuses a user who does not own the Instance", async () => {
    const t = convexTest(schema, modules);
    await seedActiveAgent(t);
    await expect(
      t.withIdentity(STRANGER).mutation(api.project_agents.setHiddenMissionTypes, {
        instanceId: INSTANCE,
        templateId: TEMPLATE,
        hiddenMissionTypes: ["lym_create_letter_video"],
      }),
    ).rejects.toThrow(/not accessible/);
    expect((await agentFor(t, OWNER))?.hiddenMissionTypes).toBeUndefined();
  });
});
