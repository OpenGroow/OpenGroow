import { insertInstance } from "./instance_fixture";
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { createHmac, createHash, randomUUID } from "node:crypto";
import { convexTest } from "convex-test";
import schema from "../schema";

// Stub auth-related env vars required by auth.ts during module load
process.env.DASHBOARD_URL = "http://localhost:3001";
process.env.BETTER_AUTH_SECRET = "test-better-auth-secret";
process.env.BROKER_URL = "http://localhost:4000";
process.env.BROKER_KEY_ID = "test-broker-key";
process.env.BROKER_SECRET = "test-broker-secret";
process.env.OPENCLAW_CONTROL_URL = "http://localhost:4001";
process.env.OPENCLAW_CONTROL_KEY_ID = "test-control-key";
process.env.OPENCLAW_CONTROL_SECRET = "test-control-secret";

const modules = {
  "../_generated/api.ts": () => import("../_generated/api.js"),
  "../agent_hmac.ts": () => import("../agent_hmac.js"),
  "../events.ts": () => import("../events.js"),
  "../http.ts": () => import("../http.js"),
  "../instances.ts": () => import("../instances.js"),
  "../instances_node.ts": () => import("../instances_node.js"),
  "../missions.ts": () => import("../missions.js"),
  "../mission_summary_http.ts": () => import("../mission_summary_http.js"),
  "../project_agents.ts": () => import("../project_agents.js"),
  "../project_agents_node.ts": () => import("../project_agents_node.js"),
  "../runs.ts": () => import("../runs.js"),
};

// Helpers to sign requests the same way an Agent would
const TEST_KEY_ID = "agent-test-key";
const TEST_SECRET = "supersecretkey123";

function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

function hmacSha256Hex(secret: string, payload: string): string {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

function signRequest(
  method: string,
  path: string,
  body: string,
  overrides: Partial<{ ts: string; nonce: string; keyId: string; secret: string }> = {},
): Record<string, string> {
  const ts = overrides.ts ?? String(Date.now());
  const nonce = overrides.nonce ?? randomUUID();
  const keyId = overrides.keyId ?? TEST_KEY_ID;
  const secret = overrides.secret ?? TEST_SECRET;
  const bodyHash = sha256Hex(body);
  const stringToSign = [method.toUpperCase(), path, ts, nonce, bodyHash].join("\n");
  const signature = hmacSha256Hex(secret, stringToSign);
  return {
    "x-agent-key-id": keyId,
    "x-agent-ts": ts,
    "x-agent-nonce": nonce,
    "x-agent-signature": signature,
    "Content-Type": "application/json",
  };
}

// We test the HTTP handler by calling it directly through convex-test's fetch
// The AGENT_HMAC_KEYS env var must be set for the handler to accept requests

const INSTANCE_ID = "openclaw-instance-http-summary";
const TEMPLATE_ID = "@opengroow/seo";
const OWNER = {
  name: "Owner",
  email: "o@example.com",
  tokenIdentifier: "test|owner-http-summary",
  subject: "owner-http-summary",
};

async function seedAndCreateMission(t: ReturnType<typeof convexTest>) {
  const now = new Date().toISOString();
  await t.run(async (ctx) => {
    await insertInstance(ctx, {
      jobId: `job-${INSTANCE_ID}`,
      status: "running",
      runtimeStatus: "linked",
      runtimeReady: true,
      createdAt: now,
      openclawId: INSTANCE_ID,
      updatedAt: now,
      userId: OWNER.subject,
    });
    await ctx.db.insert("projectAgents", {
      instanceId: INSTANCE_ID,
      templateId: TEMPLATE_ID,
      status: "active",
      openclawAgentName: TEMPLATE_ID,
      mcpServerKeys: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  });
  const { missionId } = await t.withIdentity(OWNER).mutation(
    (await import("../_generated/api.js")).api.missions.create,
    {
      instanceId: INSTANCE_ID,
      templateId: TEMPLATE_ID,
      type: "create_article",
      payload: {},
      name: "Test Mission",
    },
  );
  return missionId;
}

describe("POST /api/mission-summary — endpoint behavior", () => {
  beforeEach(() => {
    process.env.AGENT_HMAC_KEYS = JSON.stringify({
      [TEST_KEY_ID]: { secret: TEST_SECRET, instanceId: INSTANCE_ID, ownerId: OWNER.subject },
    });
  });

  afterEach(() => {
    delete process.env.AGENT_HMAC_KEYS;
  });

  it("returns 401 when HMAC headers are missing", async () => {
    const t = convexTest(schema, modules);
    const body = JSON.stringify({ missionId: "fake-id", summary: "test" });

    const response = await t.fetch("/api/mission-summary", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });

    expect(response.status).toBe(401);
  });

  it("returns 401 when HMAC signature is invalid", async () => {
    const t = convexTest(schema, modules);
    const body = JSON.stringify({ missionId: "fake-id", summary: "test" });
    const headers = signRequest("POST", "/api/mission-summary", body, { secret: "wrong-secret" });

    const response = await t.fetch("/api/mission-summary", {
      method: "POST",
      headers,
      body,
    });

    expect(response.status).toBe(401);
  });

  it("returns 400 when body contains a status field", async () => {
    const t = convexTest(schema, modules);
    const missionId = await seedAndCreateMission(t);
    const body = JSON.stringify({ missionId, summary: "test summary", status: "done" });
    const headers = signRequest("POST", "/api/mission-summary", body);

    const response = await t.fetch("/api/mission-summary", {
      method: "POST",
      headers,
      body,
    });

    expect(response.status).toBe(400);
    const json = await response.json() as { error: string };
    expect(json.error).toContain("status");
  });

  it("writes the summary and returns 200 with valid HMAC and no status", async () => {
    const t = convexTest(schema, modules);
    const missionId = await seedAndCreateMission(t);
    const body = JSON.stringify({ missionId, summary: "Article about running shoes" });
    const headers = signRequest("POST", "/api/mission-summary", body);

    const response = await t.fetch("/api/mission-summary", {
      method: "POST",
      headers,
      body,
    });

    expect(response.status).toBe(200);

    const mission = await t.run(async (ctx) => ctx.db.get(missionId));
    expect(mission?.summary).toBe("Article about running shoes");
    expect(mission?.status).toBe("todo");
  });
});
