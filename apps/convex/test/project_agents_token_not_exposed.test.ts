import { insertInstance } from "./instance_fixture";
import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import { api, internal } from "../_generated/api";
import schema from "../schema";
import { generateAgentToken } from "../internal_mcp/agent_token";

const modules = {
  "../_generated/api.ts": () => import("../_generated/api.js"),
  "../instances.ts": () => import("../instances.js"),
  "../jobs.ts": () => import("../jobs.js"),
  "../project_agents.ts": () => import("../project_agents.js"),
};

const INSTANCE = "instance-token";
const TEMPLATE = "example/planner";
const OWNER = { name: "Owner", email: "owner@example.com", tokenIdentifier: "test|owner", subject: "owner" };

async function seed(t: ReturnType<typeof convexTest>, config: Record<string, unknown>) {
  await t.run((ctx) =>
    insertInstance(ctx, {
      jobId: "provisioning-job",
      status: "running",
      runtimeStatus: "linked",
      runtimeReady: true,
      createdAt: "2026-10-01T00:00:00.000Z",
      openclawId: INSTANCE,
      updatedAt: "2026-10-01T00:00:00.000Z",
      userId: OWNER.subject,
    }),
  );
  const args = { instanceId: INSTANCE, templateId: TEMPLATE, status: "active" as const };
  await t.mutation(internal.project_agents.upsert, args);
  await t.mutation(internal.project_agents.upsert, { ...args, config });
}

describe("the Internal MCP Agent token is never sent to clients", () => {
  it("strips the token from listByInstance and get, keeping other config", async () => {
    const t = convexTest(schema, modules);
    const token = generateAgentToken(INSTANCE, TEMPLATE);
    await seed(t, { apiKey: token, region: "eu" });
    const client = t.withIdentity(OWNER);
    const listed = await client.query(api.project_agents.listByInstance, { instanceId: INSTANCE });
    const fetched = await client.query(api.project_agents.get, { instanceId: INSTANCE, templateId: TEMPLATE });
    expect(JSON.stringify(listed)).not.toContain(token);
    expect(JSON.stringify(fetched)).not.toContain(token);
    expect(listed[0].config).toEqual({ region: "eu" });
  });

  it("still returns an apiKey the operator typed for a third-party service", async () => {
    const t = convexTest(schema, modules);
    await seed(t, { apiKey: "sk-user-key" });
    const listed = await t.withIdentity(OWNER).query(api.project_agents.listByInstance, { instanceId: INSTANCE });
    expect(listed[0].config).toEqual({ apiKey: "sk-user-key" });
  });
});
