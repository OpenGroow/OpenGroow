import { insertInstance } from "./instance_fixture";
import { describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import { api, internal } from "../_generated/api";
import schema from "../schema";
import { RUNTIME_OPENCLAW_EXEC_CANCEL, RUNTIME_OPENCLAW_EXEC_CANCEL_RESULT, buildRuntimeResultEventId } from "@opengroow/protocol";

// cancelMission is an action that dispatches a runtime command and waits for
// the broker's result event (enqueueInteractiveCommand → waitForRuntimeEvent,
// see auth_node.ts's cancelAuth for the sibling pattern). enqueueInteractiveCommand
// normally also triggers a real dispatch to the runtime over HTTP
// (commands_node.dispatch); that's out of scope for this test, so — exactly
// like apps/convex/test/auth_node.test.ts — it's mocked down to just the
// enqueue mutation, and the "runtime" side of the round trip is simulated by
// writing the result directly into `events`, the same table
// waitForRuntimeEvent's fallback path (and getRuntimeCommandResult) reads.
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
  "../commands.ts": () => import("../commands.js"),
  "../commands_node.ts": () => import("../commands_node.js"),
  "../events.ts": () => import("../events.js"),
  "../instances.ts": () => import("../instances.js"),
  "../missions.ts": () => import("../missions.js"),
  "../missions_node.ts": () => import("../missions_node.js"),
  "../runs.ts": () => import("../runs.js"),
  "../runtime_commands_node.ts": () => import("../runtime_commands_node.js"),
};

const INSTANCE_ID = "openclaw-instance-cancel-mission-1";
const TEMPLATE_ID = "article";

const OWNER = {
  name: "Owner",
  email: "o@e.com",
  tokenIdentifier: "test|cancel-mission-owner",
  subject: "owner-cancel-mission",
};

const OTHER = {
  name: "Other",
  email: "x@e.com",
  tokenIdentifier: "test|cancel-mission-other",
  subject: "other-cancel-mission",
};

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
      userId: OWNER.subject,
    });
  });
}

async function seedMission(
  t: ReturnType<typeof convexTest>,
  status: "todo" | "doing" | "to_validate" | "approved" | "done" | "failed" | "cancelled" = "doing",
) {
  const now = Date.now();
  return t.run(async (ctx) => {
    return ctx.db.insert("missions", {
      ownerId: OWNER.subject,
      instanceId: INSTANCE_ID,
      templateId: TEMPLATE_ID,
      type: "create_article",
      payload: {},
      status,
      createdAt: now,
      updatedAt: now,
    });
  });
}

async function seedRun(
  t: ReturnType<typeof convexTest>,
  missionId: Awaited<ReturnType<typeof seedMission>>,
  status: "pending" | "dispatching" | "running" | "awaiting_job" | "completed" | "failed" | "cancelled" | "resumed" = "running",
  sessionKey = "mega-run-session-0",
  createdAt = Date.now(),
) {
  return t.run(async (ctx) => {
    return ctx.db.insert("runs", {
      missionId,
      ownerId: OWNER.subject,
      instanceId: INSTANCE_ID,
      templateId: TEMPLATE_ID,
      agentName: "article-agent",
      sessionKey,
      status,
      createdAt,
      updatedAt: createdAt,
    });
  });
}

/** The most recently enqueued RUNTIME_OPENCLAW_EXEC_CANCEL command, or null. */
async function getLastCancelCommand(t: ReturnType<typeof convexTest>) {
  return t.run(async (ctx) => {
    const commands = await ctx.db
      .query("commands")
      .filter((q) => q.eq(q.field("type"), RUNTIME_OPENCLAW_EXEC_CANCEL))
      .collect();
    return commands[commands.length - 1] ?? null;
  });
}

/**
 * Simulate the gateway/worker relay replying to a RUNTIME_OPENCLAW_EXEC_CANCEL
 * command with a result event — the same shape handleOpenClawExecCancel
 * (openclaw-runtime-worker) produces.
 */
async function simulateCancelResult(
  t: ReturnType<typeof convexTest>,
  outcome: { ok: true; cancelled: boolean } | { ok: false; error: string },
) {
  const deadline = Date.now() + 5000;
  let cmd: { _id: string; instanceId: string } | null = null;
  while (Date.now() < deadline) {
    cmd = await getLastCancelCommand(t);
    if (cmd) break;
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
  }
  if (!cmd) throw new Error("Timed out waiting for RUNTIME_OPENCLAW_EXEC_CANCEL command to be enqueued");

  await t.run(async (ctx) => {
    const now = Date.now();
    await ctx.db.insert("events", {
      instanceId: cmd!.instanceId,
      eventId: buildRuntimeResultEventId(cmd!._id),
      type: RUNTIME_OPENCLAW_EXEC_CANCEL_RESULT,
      payload:
        outcome.ok
          ? {
              commandId: cmd!._id,
              instanceId: cmd!.instanceId,
              ok: true,
              data: { cancelled: outcome.cancelled },
            }
          : {
              commandId: cmd!._id,
              instanceId: cmd!.instanceId,
              ok: false,
              error: outcome.error,
              data: { cancelled: false },
            },
      ts: now,
      createdAt: now,
    });
  });
}

describe("missions_node.cancelMission", () => {
  it("throws Forbidden when a different user tries to cancel", async () => {
    const t = convexTest(schema, modules);
    await seedInstance(t);
    const missionId = await seedMission(t, "doing");
    await seedRun(t, missionId, "running");

    await expect(
      t.withIdentity(OTHER).action(api.missions_node.cancelMission, { missionId }),
    ).rejects.toThrow(/Forbidden/i);

    const mission = await t.run((ctx) => ctx.db.get(missionId));
    expect(mission?.status).toBe("doing");
  });

  it("rejects when the mission is not doing", async () => {
    const t = convexTest(schema, modules);
    await seedInstance(t);
    const missionId = await seedMission(t, "todo");

    await expect(
      t.withIdentity(OWNER).action(api.missions_node.cancelMission, { missionId }),
    ).rejects.toThrow(/Mission is not currently running/i);
  });

  it("rejects when the mission is doing but has no live run", async () => {
    const t = convexTest(schema, modules);
    await seedInstance(t);
    const missionId = await seedMission(t, "doing");
    await seedRun(t, missionId, "completed");

    await expect(
      t.withIdentity(OWNER).action(api.missions_node.cancelMission, { missionId }),
    ).rejects.toThrow(/Mission is not currently running/i);
  });

  it("transitions the mission and run to cancelled on a successful runtime round-trip", async () => {
    const t = convexTest(schema, modules);
    await seedInstance(t);
    const missionId = await seedMission(t, "doing");
    const runId = await seedRun(t, missionId, "running", "mega-run-session-9");

    const [result] = await Promise.all([
      t.withIdentity(OWNER).action(api.missions_node.cancelMission, { missionId }),
      simulateCancelResult(t, { ok: true, cancelled: true }),
    ]);

    expect(result).toEqual({ ok: true });

    // The gateway kills by OpenClaw agent session, so the command must carry
    // the live Run's sessionKey — not its runId, nor the exec command's id.
    const command = await getLastCancelCommand(t);
    expect(command?.payload).toMatchObject({ sessionId: "mega-run-session-9" });

    const mission = await t.run((ctx) => ctx.db.get(missionId));
    expect(mission?.status).toBe("cancelled");

    const run = await t.run((ctx) => ctx.db.get(runId));
    expect(run?.status).toBe("cancelled");
  });

  it("leaves the mission untouched at doing when the runtime round-trip fails", async () => {
    const t = convexTest(schema, modules);
    await seedInstance(t);
    const missionId = await seedMission(t, "doing");
    const runId = await seedRun(t, missionId, "running", "mega-run-session-9");

    await expect(
      Promise.all([
        t.withIdentity(OWNER).action(api.missions_node.cancelMission, { missionId }),
        simulateCancelResult(t, { ok: false, error: "gateway unreachable" }),
      ]),
    ).rejects.toThrow(/gateway unreachable/i);

    const mission = await t.run((ctx) => ctx.db.get(missionId));
    expect(mission?.status).toBe("doing");

    const run = await t.run((ctx) => ctx.db.get(runId));
    expect(run?.status).toBe("running");
  });

  it("leaves the mission untouched at doing when the cancel result's data.cancelled is malformed", async () => {
    // An `ok: true` result whose `data.cancelled` is missing or not a
    // boolean is a malformed payload (runtime_commands_node_parsers.ts),
    // rejected outright rather than silently coerced to `false` — a garbled
    // response must not be treated as a confirmed cancel.
    const t = convexTest(schema, modules);
    await seedInstance(t);
    const missionId = await seedMission(t, "doing");
    const runId = await seedRun(t, missionId, "running", "mega-run-session-9");

    const cancelPromise = t.withIdentity(OWNER).action(api.missions_node.cancelMission, { missionId });

    const cmd = await (async () => {
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline) {
        const found = await getLastCancelCommand(t);
        if (found) return found;
        await new Promise<void>((resolve) => setTimeout(resolve, 50));
      }
      throw new Error("Timed out waiting for RUNTIME_OPENCLAW_EXEC_CANCEL command to be enqueued");
    })();
    await t.run(async (ctx) => {
      const now = Date.now();
      await ctx.db.insert("events", {
        instanceId: cmd.instanceId,
        eventId: buildRuntimeResultEventId(cmd._id),
        type: RUNTIME_OPENCLAW_EXEC_CANCEL_RESULT,
        payload: { commandId: cmd._id, instanceId: cmd.instanceId, ok: true, data: {} },
        ts: now,
        createdAt: now,
      });
    });

    await expect(cancelPromise).rejects.toThrow(/Failed to stop mission/i);

    const mission = await t.run((ctx) => ctx.db.get(missionId));
    expect(mission?.status).toBe("doing");

    const run = await t.run((ctx) => ctx.db.get(runId));
    expect(run?.status).toBe("running");
  });

  it("stops the newest live run when a stale dispatching run is also present", async () => {
    const t = convexTest(schema, modules);
    await seedInstance(t);
    const missionId = await seedMission(t, "doing");
    // A stale `dispatching` Run left behind by an earlier hop, inserted first
    // so it comes first in index order; the Run actually executing is newer.
    const staleRunId = await seedRun(t, missionId, "dispatching", "stale-session", 1_000);
    const liveRunId = await seedRun(t, missionId, "running", "live-session", 2_000);

    await Promise.all([
      t.withIdentity(OWNER).action(api.missions_node.cancelMission, { missionId }),
      simulateCancelResult(t, { ok: true, cancelled: true }),
    ]);

    const command = await getLastCancelCommand(t);
    expect(command?.payload).toMatchObject({ sessionId: "live-session" });

    expect((await t.run((ctx) => ctx.db.get(liveRunId)))?.status).toBe("cancelled");
    expect((await t.run((ctx) => ctx.db.get(staleRunId)))?.status).toBe("dispatching");
  });
});

// A reconciliation tick already in flight when the operator's Stop lands must
// not resurrect the Mission. `runs.markResumed` no-ops on the cancelled Run,
// but the Mission-side half is a separate mutation that would otherwise
// dispatch a brand-new Run — the exact quota burn Stop exists to end.
describe("missions.resumeMission* never dispatch a new Run for a cancelled Mission", () => {
  it("resumeMission is a no-op when the mission is already cancelled", async () => {
    const t = convexTest(schema, modules);
    await seedInstance(t);
    const missionId = await seedMission(t, "cancelled");
    await seedRun(t, missionId, "cancelled", "mega-run-session-r1");

    const { runId } = await t.mutation(internal.missions.resumeMission, {
      missionId,
      intermediateResult: { jobType: "plan_article", output: {} },
    });

    expect(runId).toBeNull();
    const runs = await t.run((ctx) =>
      ctx.db.query("runs").withIndex("by_mission", (q) => q.eq("missionId", missionId)).collect(),
    );
    expect(runs).toHaveLength(1);
    expect((await t.run((ctx) => ctx.db.get(missionId)))?.status).toBe("cancelled");
  });

  it("resumeMissionAfterRetryableFailure is a no-op when the mission is already cancelled", async () => {
    const t = convexTest(schema, modules);
    await seedInstance(t);
    const missionId = await seedMission(t, "cancelled");
    await seedRun(t, missionId, "cancelled", "mega-run-session-r2");

    const { runId } = await t.mutation(internal.missions.resumeMissionAfterRetryableFailure, {
      missionId,
      jobType: "plan_article",
      error: "boom",
    });

    expect(runId).toBeNull();
    const runs = await t.run((ctx) =>
      ctx.db.query("runs").withIndex("by_mission", (q) => q.eq("missionId", missionId)).collect(),
    );
    expect(runs).toHaveLength(1);
    expect((await t.run((ctx) => ctx.db.get(missionId)))?.status).toBe("cancelled");
  });
});

// The `cancelling` marker (issue #482) is set before cancelMission dispatches
// the gateway kill command and awaits the runtime event — closing the race
// window during which an External Job resume could otherwise land, dispatch
// a fresh Run, and then have `markCancelled` (at the end of cancelMission)
// target the now-superseded old Run instead.
describe("resumeMission* reject a resume that lands while a Stop is in flight", () => {
  it("resumeMission is a no-op once cancelMission has reserved cancellation intent", async () => {
    const t = convexTest(schema, modules);
    await seedInstance(t);
    const missionId = await seedMission(t, "doing");
    await seedRun(t, missionId, "running", "mega-run-session-race1");

    const cancelPromise = t.withIdentity(OWNER).action(api.missions_node.cancelMission, { missionId });

    // Wait for cancelMission to have reserved cancellation intent (it does so
    // before dispatching the cancel command) — polling `cancelling` rather
    // than the command table, since the marker is written strictly earlier.
    const deadline = Date.now() + 5000;
    let cancelling = false;
    while (Date.now() < deadline) {
      cancelling = (await t.run((ctx) => ctx.db.get(missionId)))?.cancelling === true;
      if (cancelling) break;
      await new Promise<void>((resolve) => setTimeout(resolve, 20));
    }
    expect(cancelling).toBe(true);

    // An External Job resume lands during the wait window, before
    // markCancelled has run.
    const { runId } = await t.mutation(internal.missions.resumeMission, {
      missionId,
      intermediateResult: { jobType: "plan_article", output: {} },
    });
    expect(runId).toBeNull();

    await simulateCancelResult(t, { ok: true, cancelled: true });
    await expect(cancelPromise).resolves.toEqual({ ok: true });

    const runs = await t.run((ctx) =>
      ctx.db.query("runs").withIndex("by_mission", (q) => q.eq("missionId", missionId)).collect(),
    );
    // Only the original Run — the rejected resume never created a new one.
    expect(runs).toHaveLength(1);
    expect(runs[0]?.status).toBe("cancelled");
    expect((await t.run((ctx) => ctx.db.get(missionId)))?.status).toBe("cancelled");
  });
});

// `reserveCancellation` re-reads the Mission's live Run *in the same
// mutation* that sets `cancelling`, instead of `cancelMission` trusting a
// separate, slightly-earlier read. This closes the race where a concurrent
// External Job resume commits in the gap between that earlier read and
// `cancelling` actually being persisted: it would otherwise dispatch a fresh
// Run and demote the originally-read Run to `resumed`, leaving the kill
// command and `markCancelled` to target a Run that's no longer live.
describe("missions.reserveCancellation targets the current live Run, not a stale reference", () => {
  it("targets a Run created by a resume that already landed before reservation", async () => {
    const t = convexTest(schema, modules);
    await seedInstance(t);
    const missionId = await seedMission(t, "doing");
    // Simulates the post-race state: an External Job resume already
    // committed — the originally-live Run moved to `resumed`, and a fresh
    // Run took over as the Mission's live Run — before reserveCancellation
    // runs.
    await seedRun(t, missionId, "resumed", "superseded-session", 1_000);
    const newRunId = await seedRun(t, missionId, "running", "current-session", 2_000);

    const liveRun = await t.mutation(internal.missions.reserveCancellation, { missionId });

    expect(liveRun?._id).toBe(newRunId);
    expect(liveRun?.sessionKey).toBe("current-session");
    expect((await t.run((ctx) => ctx.db.get(missionId)))?.cancelling).toBe(true);
  });

  it("returns null and does not set cancelling when the mission has no live run", async () => {
    const t = convexTest(schema, modules);
    await seedInstance(t);
    const missionId = await seedMission(t, "doing");
    await seedRun(t, missionId, "completed", "done-session");

    const liveRun = await t.mutation(internal.missions.reserveCancellation, { missionId });

    expect(liveRun).toBeNull();
    expect((await t.run((ctx) => ctx.db.get(missionId)))?.cancelling).toBeUndefined();
  });
});

// The eligibility guard in cancelMission runs before a dispatch-and-wait that
// can take seconds. A Run that finished naturally inside that window must not
// be rewritten to `cancelled`.
describe("runs.markCancelled only transitions a still-live Run", () => {
  it("is a no-op against a Run that completed during the cancel round-trip", async () => {
    const t = convexTest(schema, modules);
    await seedInstance(t);
    const missionId = await seedMission(t, "to_validate");
    const runId = await seedRun(t, missionId, "completed", "mega-run-session-c1");

    await t.mutation(internal.runs.markCancelled, { runId });

    expect((await t.run((ctx) => ctx.db.get(runId)))?.status).toBe("completed");
    expect((await t.run((ctx) => ctx.db.get(missionId)))?.status).toBe("to_validate");
  });
});

describe("runs.markCompleted/markResumed/markFailed no-op against an already-cancelled Run", () => {
  it("markFailed is a no-op instead of throwing when the run is already cancelled", async () => {
    const t = convexTest(schema, modules);
    await seedInstance(t);
    const missionId = await seedMission(t, "cancelled");
    const runId = await seedRun(t, missionId, "cancelled", "mega-run-session-1");

    await t.mutation(internal.runs.markFailed, {
      runId,
      code: "timeout",
      message: "late exec result after cancel",
    });

    const run = await t.run((ctx) => ctx.db.get(runId));
    expect(run?.status).toBe("cancelled");
    const mission = await t.run((ctx) => ctx.db.get(missionId));
    expect(mission?.status).toBe("cancelled");
  });

  it("markCompleted is a no-op instead of throwing when the run is already cancelled", async () => {
    const t = convexTest(schema, modules);
    await seedInstance(t);
    const missionId = await seedMission(t, "cancelled");
    const runId = await seedRun(t, missionId, "cancelled", "mega-run-session-2");

    await t.mutation(internal.runs.markCompleted, {
      runId,
      result: { status: "success", summary: "late" },
    });

    const run = await t.run((ctx) => ctx.db.get(runId));
    expect(run?.status).toBe("cancelled");
    const mission = await t.run((ctx) => ctx.db.get(missionId));
    expect(mission?.status).toBe("cancelled");
  });

  it("markResumed is a no-op instead of throwing when the run is already cancelled", async () => {
    const t = convexTest(schema, modules);
    await seedInstance(t);
    const missionId = await seedMission(t, "cancelled");
    const runId = await seedRun(t, missionId, "cancelled", "mega-run-session-3");

    await t.mutation(internal.runs.markResumed, { runId, intermediateResult: { note: "late" } });

    const run = await t.run((ctx) => ctx.db.get(runId));
    expect(run?.status).toBe("cancelled");
  });
});
