import { insertInstance } from "./instance_fixture";
import { describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import { api } from "../_generated/api";
import schema from "../schema";
import {
  RUNTIME_AUTH_ACTIVATE,
  RUNTIME_AUTH_ACTIVATE_RESULT,
  RUNTIME_AUTH_STATUS,
  RUNTIME_AUTH_STATUS_RESULT,
  buildRuntimeResultEventId,
} from "@opengroow/protocol";

vi.mock("../runtime_commands_node", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../runtime_commands_node")>();
  const { internal } = await import("../_generated/api");
  return {
    ...actual,
    enqueueInteractiveCommand: (
      ctx: Parameters<typeof actual.enqueueInteractiveCommand>[0],
      args: Parameters<typeof actual.enqueueInteractiveCommand>[1],
    ) => ctx.runMutation(internal.commands.enqueueInteractive, args),
  };
});

const modules = {
  "../_generated/api.ts": () => import("../_generated/api.js"),
  "../auth_node.ts": () => import("../auth_node.js"),
  "../commands.ts": () => import("../commands.js"),
  "../commands_node.ts": () => import("../commands_node.js"),
  "../events.ts": () => import("../events.js"),
  "../instances.ts": () => import("../instances.js"),
  "../runtime_commands_node.ts": () => import("../runtime_commands_node.js"),
};

const INSTANCE_ID = "openclaw-instance-auth-1";

async function seedInstance(t: ReturnType<typeof convexTest>) {
  const isoNow = new Date().toISOString();
  await t.run(async (ctx) => {
    await insertInstance(ctx, {
      jobId: `job-${INSTANCE_ID}`,
      status: "running",
      runtimeStatus: "linked",
      runtimeReady: true,
      createdAt: isoNow,
      openclawId: INSTANCE_ID,
      updatedAt: isoNow,
    });
  });
}

/**
 * Simulate the runtime replying to a RUNTIME_AUTH_STATUS poll with a
 * "succeeded" auth session snapshot — the same shape control-socket-server.js's
 * buildAuthSnapshot() returns once `openclaw onboard`'s child process reports
 * "Onboarding complete".
 */
async function simulateAuthStatusSucceeded(
  t: ReturnType<typeof convexTest>,
  data: { sessionId: string; provider: string; model?: string },
) {
  const deadline = Date.now() + 5000;
  let cmd: { _id: string; instanceId: string } | null = null;
  while (Date.now() < deadline) {
    cmd = await t.run(async (ctx) => {
      const commands = await ctx.db
        .query("commands")
        .filter((q) => q.eq(q.field("type"), RUNTIME_AUTH_STATUS))
        .collect();
      return commands[commands.length - 1] ?? null;
    });
    if (cmd) break;
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
  }
  if (!cmd) throw new Error("Timed out waiting for RUNTIME_AUTH_STATUS command to be enqueued");

  await t.run(async (ctx) => {
    const now = Date.now();
    await ctx.db.insert("events", {
      instanceId: cmd!.instanceId,
      eventId: buildRuntimeResultEventId(cmd!._id),
      type: RUNTIME_AUTH_STATUS_RESULT,
      payload: {
        commandId: cmd!._id,
        instanceId: cmd!.instanceId,
        ok: true,
        data: {
          sessionId: data.sessionId,
          provider: data.provider,
          status: "succeeded",
          logs: ["[auth] completed " + data.provider],
          model: data.model,
        },
      },
      ts: now,
      createdAt: now,
    });
  });
}

/**
 * Simulate the runtime replying to a RUNTIME_AUTH_ACTIVATE command (used by
 * both activateSubscriptionProvider and updateSubscriptionModel) with a
 * successful control-socket-server.js handleAuthActivate response.
 */
async function simulateAuthActivateResult(
  t: ReturnType<typeof convexTest>,
  data: { provider: string; model: string },
) {
  const deadline = Date.now() + 5000;
  let cmd: { _id: string; instanceId: string } | null = null;
  while (Date.now() < deadline) {
    cmd = await t.run(async (ctx) => {
      const commands = await ctx.db
        .query("commands")
        .filter((q) => q.eq(q.field("type"), RUNTIME_AUTH_ACTIVATE))
        .collect();
      return commands[commands.length - 1] ?? null;
    });
    if (cmd) break;
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
  }
  if (!cmd) throw new Error("Timed out waiting for RUNTIME_AUTH_ACTIVATE command to be enqueued");

  await t.run(async (ctx) => {
    const now = Date.now();
    await ctx.db.insert("events", {
      instanceId: cmd!.instanceId,
      eventId: buildRuntimeResultEventId(cmd!._id),
      type: RUNTIME_AUTH_ACTIVATE_RESULT,
      payload: {
        commandId: cmd!._id,
        instanceId: cmd!.instanceId,
        ok: true,
        data: { provider: data.provider, model: data.model },
      },
      ts: now,
      createdAt: now,
    });
  });
}

describe("auth_node.updateSubscriptionModel", () => {
  it("upserts the subscription Provider with the new model and marks it in use", async () => {
    const t = convexTest(schema, modules);
    await seedInstance(t);

    // Seed an existing subscription Provider on a different model, the way
    // a prior successful link would have — updateSubscriptionModel should
    // overwrite its model rather than requiring a fresh link.
    await t.run(async (ctx) => {
      const row = await ctx.db
        .query("instances")
        .withIndex("by_openclaw_id", (q) => q.eq("openclawId", INSTANCE_ID))
        .unique();
      await ctx.db.patch(row!._id, {
        providers: [
          {
            kind: "subscription",
            provider: "openai",
            model: "openai/gpt-5.5",
            inUse: true,
            updatedAt: new Date().toISOString(),
          },
        ],
      });
    });

    const [result] = await Promise.all([
      t.action(api.auth_node.updateSubscriptionModel, {
        instanceId: INSTANCE_ID,
        provider: "openai",
        model: "openai/gpt-5.5-mini",
      }),
      simulateAuthActivateResult(t, { provider: "openai", model: "openai/gpt-5.5-mini" }),
    ]);

    expect(result).toMatchObject({ status: 200, provider: "openai", model: "openai/gpt-5.5-mini" });

    const instance = await t.run(async (ctx) => {
      return await ctx.db
        .query("instances")
        .withIndex("by_openclaw_id", (q) => q.eq("openclawId", INSTANCE_ID))
        .unique();
    });
    expect(instance?.providers).toEqual([
      expect.objectContaining({
        kind: "subscription",
        provider: "openai",
        model: "openai/gpt-5.5-mini",
        inUse: true,
      }),
    ]);
  });

  it("rejects a blank model without dispatching a runtime command", async () => {
    const t = convexTest(schema, modules);
    await seedInstance(t);

    const result = await t.action(api.auth_node.updateSubscriptionModel, {
      instanceId: INSTANCE_ID,
      provider: "openai",
      model: "   ",
    });

    expect(result).toEqual({
      status: 400,
      error: "instanceId, provider, and model are required",
    });
  });
});

describe("auth_node.activateSubscriptionProvider", () => {
  it("includes the stored model in the RUNTIME_AUTH_ACTIVATE payload", async () => {
    const t = convexTest(schema, modules);
    await seedInstance(t);

    const [result] = await Promise.all([
      t.action(api.auth_node.activateSubscriptionProvider, {
        instanceId: INSTANCE_ID,
        provider: "openai",
        model: "openai/gpt-5.5-mini",
      }),
      simulateAuthActivateResult(t, { provider: "openai", model: "openai/gpt-5.5-mini" }),
    ]);

    expect(result).toMatchObject({ status: 200 });

    const command = await t.run(async (ctx) => {
      const commands = await ctx.db
        .query("commands")
        .filter((q) => q.eq(q.field("type"), RUNTIME_AUTH_ACTIVATE))
        .collect();
      return commands[commands.length - 1] ?? null;
    });
    expect(command?.payload).toMatchObject({
      provider: "openai",
      model: "openai/gpt-5.5-mini",
    });
  });

  it("omits model from the RUNTIME_AUTH_ACTIVATE payload when none is stored", async () => {
    const t = convexTest(schema, modules);
    await seedInstance(t);

    const [result] = await Promise.all([
      t.action(api.auth_node.activateSubscriptionProvider, {
        instanceId: INSTANCE_ID,
        provider: "openai",
      }),
      simulateAuthActivateResult(t, { provider: "openai", model: "openai/gpt-5.5" }),
    ]);

    expect(result).toMatchObject({ status: 200 });

    const command = await t.run(async (ctx) => {
      const commands = await ctx.db
        .query("commands")
        .filter((q) => q.eq(q.field("type"), RUNTIME_AUTH_ACTIVATE))
        .collect();
      return commands[commands.length - 1] ?? null;
    });
    expect(command?.payload).toEqual({ provider: "openai" });
  });
});

describe("auth_node.getAuthJob — subscription-linked Provider persistence", () => {
  it("upserts a subscription Provider once a poll observes status succeeded", async () => {
    const t = convexTest(schema, modules);
    await seedInstance(t);

    const [result] = await Promise.all([
      t.action(api.auth_node.getAuthJob, {
        jobId: "session-abc",
        instanceId: INSTANCE_ID,
      }),
      simulateAuthStatusSucceeded(t, {
        sessionId: "session-abc",
        provider: "openai",
        model: "openai/gpt-5.5",
      }),
    ]);

    expect(result.job?.status).toBe("succeeded");

    // This is the exact user-reported symptom: the dashboard shows "Subscription
    // linked successfully" (driven by authJob.status, asserted above) while the
    // Provider Management table (driven by instance.providers) stays empty.
    const instance = await t.run(async (ctx) => {
      return await ctx.db
        .query("instances")
        .withIndex("by_openclaw_id", (q) => q.eq("openclawId", INSTANCE_ID))
        .unique();
    });
    expect(instance?.providers).toEqual([
      expect.objectContaining({
        kind: "subscription",
        provider: "openai",
        model: "openai/gpt-5.5",
        inUse: true,
      }),
    ]);
  });
});
