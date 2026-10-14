import { insertInstance } from "./instance_fixture";
import { describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import { api } from "../_generated/api";
import schema from "../schema";
import type { Id } from "../_generated/dataModel";
import {
  RUNTIME_SESSION_TRANSCRIPT_READ_RESULT,
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
  "../commands.ts": () => import("../commands.js"),
  "../commands_node.ts": () => import("../commands_node.js"),
  "../connect_tickets.ts": () => import("../connect_tickets.js"),
  "../connect_tickets_node.ts": () => import("../connect_tickets_node.js"),
  "../events.ts": () => import("../events.js"),
  "../health.ts": () => import("../health.js"),
  "../http.ts": () => import("../http.js"),
  "../instances.ts": () => import("../instances.js"),
  "../instances_node.ts": () => import("../instances_node.js"),
  "../project_agents.ts": () => import("../project_agents.js"),
  "../project_agents_node.ts": () => import("../project_agents_node.js"),
  "../runs.ts": () => import("../runs.js"),
  "../runtime_commands_node.ts": () => import("../runtime_commands_node.js"),
  "../workspace_logs.ts": () => import("../workspace_logs.js"),
  "../workspace_logs_node.ts": () => import("../workspace_logs_node.js"),
};

const INSTANCE_ID = "openclaw-instance-logs-1";
const TEMPLATE_ID = "@opengroow/seo";
const WORKSPACE_KEY = "ws-logs-abc";
const AGENT_NAME = "seo-agent";
const OWNER = { name: "Owner", email: "o@e.com", tokenIdentifier: "test|logs-1", subject: "owner-logs-1" };
const OTHER = { name: "Other", email: "x@e.com", tokenIdentifier: "test|other-logs", subject: "other-logs-1" };

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

async function seedProjectAgent(
  t: ReturnType<typeof convexTest>,
  opts: { workspaceKey?: string; openclawAgentName?: string; templateId?: string } = {},
) {
  const now = Date.now();
  await t.run(async (ctx) => {
    await ctx.db.insert("projectAgents", {
      instanceId: INSTANCE_ID,
      templateId: opts.templateId ?? TEMPLATE_ID,
      status: "active",
      mcpServerKeys: [],
      workspaceKey: opts.workspaceKey ?? WORKSPACE_KEY,
      openclawAgentName: opts.openclawAgentName ?? AGENT_NAME,
      createdAt: now,
      updatedAt: now,
    });
  });
}

async function seedMission(
  t: ReturnType<typeof convexTest>,
  opts: { name?: string; templateId?: string } = {},
): Promise<Id<"missions">> {
  const now = Date.now();
  return await t.run(async (ctx) => {
    return await ctx.db.insert("missions", {
      ownerId: OWNER.subject,
      instanceId: INSTANCE_ID,
      templateId: opts.templateId ?? TEMPLATE_ID,
      type: "create_article",
      payload: {},
      status: "doing",
      name: opts.name ?? "Mission",
      createdAt: now,
      updatedAt: now,
    });
  });
}

async function seedRun(
  t: ReturnType<typeof convexTest>,
  missionId: Id<"missions">,
  opts: { sessionKey: string; createdAt: number; agentName?: string; templateId?: string },
): Promise<Id<"runs">> {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("runs", {
      missionId,
      ownerId: OWNER.subject,
      instanceId: INSTANCE_ID,
      templateId: opts.templateId ?? TEMPLATE_ID,
      agentName: opts.agentName ?? AGENT_NAME,
      sessionKey: opts.sessionKey,
      status: "completed",
      createdAt: opts.createdAt,
      updatedAt: opts.createdAt,
    });
  });
}

/**
 * Simulate the runtime responding to a session-transcript-read command.
 * Polls the DB until the command appears, then inserts the result event.
 */
async function simulateSessionTranscriptResult(
  t: ReturnType<typeof convexTest>,
  data: { found: boolean; turns: Array<Record<string, unknown>> },
  opts: { ok?: boolean; error?: string; timeoutMs?: number } = {},
) {
  const ok = opts.ok !== false;
  const timeoutMs = opts.timeoutMs ?? 5000;
  const deadline = Date.now() + timeoutMs;

  let cmd: { _id: string; instanceId: string; payload: unknown } | null = null;
  while (Date.now() < deadline) {
    cmd = await t.run(async (ctx) => {
      const commands = await ctx.db
        .query("commands")
        .filter((q) => q.eq(q.field("type"), "runtime.session.transcript.read"))
        .collect();
      return commands[commands.length - 1] ?? null;
    });
    if (cmd) break;
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
  }
  if (!cmd) throw new Error("Timed out waiting for session transcript command to be enqueued");

  await t.run(async (ctx) => {
    const now = Date.now();
    await ctx.db.insert("events", {
      instanceId: cmd!.instanceId,
      eventId: buildRuntimeResultEventId(cmd!._id),
      type: RUNTIME_SESSION_TRANSCRIPT_READ_RESULT,
      payload: {
        commandId: cmd!._id,
        instanceId: cmd!.instanceId,
        ok,
        error: opts.error,
        data: { agentName: AGENT_NAME, ...data },
      },
      ts: now,
      createdAt: now,
    });
  });
}

async function lastCommandPayload(t: ReturnType<typeof convexTest>) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const cmd = await t.run(async (ctx) => {
      const commands = await ctx.db
        .query("commands")
        .filter((q) => q.eq(q.field("type"), "runtime.session.transcript.read"))
        .collect();
      return commands[commands.length - 1] ?? null;
    });
    if (cmd) return cmd.payload;
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Timed out waiting for session transcript command to be enqueued");
}

describe("workspace_logs_node.getWorkspaceRunTranscript", () => {
  it("requires authentication", async () => {
    const t = convexTest(schema, modules);
    await seedInstance(t);

    await expect(
      t.action(api.workspace_logs_node.getWorkspaceRunTranscript, {
        instanceId: INSTANCE_ID,
        workspaceKey: WORKSPACE_KEY,
      }),
    ).rejects.toThrow(/Authentication required/i);
  });

  it("rejects a user who does not own the instance", async () => {
    const t = convexTest(schema, modules);
    await seedInstance(t);

    await expect(
      t.withIdentity(OTHER).action(api.workspace_logs_node.getWorkspaceRunTranscript, {
        instanceId: INSTANCE_ID,
        workspaceKey: WORKSPACE_KEY,
      }),
    ).rejects.toThrow(/Forbidden/i);
  });

  it("returns found: false when no Agent owns this workspace yet", async () => {
    const t = convexTest(schema, modules);
    await seedInstance(t);

    const result = await t
      .withIdentity(OWNER)
      .action(api.workspace_logs_node.getWorkspaceRunTranscript, {
        instanceId: INSTANCE_ID,
        workspaceKey: WORKSPACE_KEY,
      });

    expect(result).toEqual({ found: false, turns: [] });
  });

  it("returns found: false when the Agent has never had a Run", async () => {
    const t = convexTest(schema, modules);
    await seedInstance(t);
    await seedProjectAgent(t);

    const result = await t
      .withIdentity(OWNER)
      .action(api.workspace_logs_node.getWorkspaceRunTranscript, {
        instanceId: INSTANCE_ID,
        workspaceKey: WORKSPACE_KEY,
      });

    expect(result).toEqual({ found: false, turns: [] });
  });

  it("defaults to the most recently created Run for the Agent, and dispatches its sessionKey", async () => {
    const t = convexTest(schema, modules);
    await seedInstance(t);
    await seedProjectAgent(t);
    const missionId = await seedMission(t);
    await seedRun(t, missionId, { sessionKey: "mega-run-older", createdAt: 1000 });
    const latestRunId = await seedRun(t, missionId, { sessionKey: "mega-run-latest", createdAt: 2000 });

    const resultPromise = t
      .withIdentity(OWNER)
      .action(api.workspace_logs_node.getWorkspaceRunTranscript, {
        instanceId: INSTANCE_ID,
        workspaceKey: WORKSPACE_KEY,
      });

    const turns = [
      {
        kind: "message",
        role: "user",
        text: "Write the weekly report",
        timestamp: "2026-07-02T10:00:00.000Z",
      },
      {
        kind: "message",
        role: "assistant",
        text: "Here is the report.",
        timestamp: "2026-07-02T10:00:05.000Z",
      },
    ];
    expect(await lastCommandPayload(t)).toEqual({
      agentName: AGENT_NAME,
      sessionKey: "mega-run-latest",
    });
    await simulateSessionTranscriptResult(t, { found: true, turns });

    await expect(resultPromise).resolves.toEqual({
      found: true,
      turns,
      runId: latestRunId,
      parent: { kind: "mission", missionId },
    });
  });

  it("accepts tool turns that omit `arguments` / `result`", async () => {
    // zod v3 treated a bare `z.unknown()` object key as optional at runtime;
    // v4 does not. Without `.optional()` on those two keys, one such turn
    // would reject the whole transcript payload.
    const t = convexTest(schema, modules);
    await seedInstance(t);
    await seedProjectAgent(t);
    const missionId = await seedMission(t);
    const runId = await seedRun(t, missionId, { sessionKey: "mega-run-latest", createdAt: 1000 });

    const resultPromise = t
      .withIdentity(OWNER)
      .action(api.workspace_logs_node.getWorkspaceRunTranscript, {
        instanceId: INSTANCE_ID,
        workspaceKey: WORKSPACE_KEY,
      });

    const turns = [
      { kind: "tool_call", toolName: "write_file" },
      { kind: "tool_result", toolName: "write_file", success: true },
    ];
    await simulateSessionTranscriptResult(t, { found: true, turns });

    await expect(resultPromise).resolves.toEqual({
      found: true,
      turns,
      runId,
      parent: { kind: "mission", missionId },
    });
  });

  it("accepts tool turns that omit `arguments` / `result`", async () => {
    // zod v3 treated a bare `z.unknown()` object key as optional at runtime;
    // v4 does not. Without `.optional()` on those two keys, one such turn
    // would reject the whole transcript payload.
    const t = convexTest(schema, modules);
    await seedInstance(t);
    await seedProjectAgent(t);
    const missionId = await seedMission(t);
    const runId = await seedRun(t, missionId, { sessionKey: "mega-run-latest", createdAt: 1000 });

    const resultPromise = t
      .withIdentity(OWNER)
      .action(api.workspace_logs_node.getWorkspaceRunTranscript, {
        instanceId: INSTANCE_ID,
        workspaceKey: WORKSPACE_KEY,
      });

    const turns = [
      { kind: "tool_call", toolName: "write_file" },
      { kind: "tool_result", toolName: "write_file", success: true },
    ];
    await simulateSessionTranscriptResult(t, { found: true, turns });

    await expect(resultPromise).resolves.toEqual({
      found: true,
      turns,
      runId,
      parent: { kind: "mission", missionId },
    });
  });

  it("reads a specific Run's transcript when runId is provided", async () => {
    const t = convexTest(schema, modules);
    await seedInstance(t);
    await seedProjectAgent(t);
    const missionId = await seedMission(t);
    const targetRunId = await seedRun(t, missionId, { sessionKey: "mega-run-target", createdAt: 1000 });
    await seedRun(t, missionId, { sessionKey: "mega-run-newer", createdAt: 2000 });

    const resultPromise = t
      .withIdentity(OWNER)
      .action(api.workspace_logs_node.getWorkspaceRunTranscript, {
        instanceId: INSTANCE_ID,
        workspaceKey: WORKSPACE_KEY,
        runId: targetRunId,
      });

    expect(await lastCommandPayload(t)).toEqual({
      agentName: AGENT_NAME,
      sessionKey: "mega-run-target",
    });
    await simulateSessionTranscriptResult(t, { found: true, turns: [] });

    await expect(resultPromise).resolves.toEqual({
      found: true,
      turns: [],
      runId: targetRunId,
      parent: { kind: "mission", missionId },
    });
  });

  it("returns found: false for a runId belonging to a different Agent's Run", async () => {
    const t = convexTest(schema, modules);
    await seedInstance(t);
    await seedProjectAgent(t);
    // A second Agent on the same instance, with its own Mission/Run.
    await seedProjectAgent(t, {
      workspaceKey: "ws-other",
      openclawAgentName: "other-agent",
      templateId: "other-template",
    });
    const otherMissionId = await seedMission(t, { templateId: "other-template" });
    const otherRunId = await seedRun(t, otherMissionId, {
      sessionKey: "mega-run-other-agent",
      createdAt: 1000,
      agentName: "other-agent",
      templateId: "other-template",
    });

    const result = await t
      .withIdentity(OWNER)
      .action(api.workspace_logs_node.getWorkspaceRunTranscript, {
        instanceId: INSTANCE_ID,
        workspaceKey: WORKSPACE_KEY,
        runId: otherRunId,
      });

    expect(result).toEqual({ found: false, turns: [] });
  });

  it("throws when the runtime reports a failure", async () => {
    const t = convexTest(schema, modules);
    await seedInstance(t);
    await seedProjectAgent(t);
    const missionId = await seedMission(t);
    await seedRun(t, missionId, { sessionKey: "mega-run-1", createdAt: 1000 });

    const resultPromise = t
      .withIdentity(OWNER)
      .action(api.workspace_logs_node.getWorkspaceRunTranscript, {
        instanceId: INSTANCE_ID,
        workspaceKey: WORKSPACE_KEY,
      });
    await simulateSessionTranscriptResult(
      t,
      { found: false, turns: [] },
      { ok: false, error: "boom" },
    );

    await expect(resultPromise).rejects.toThrow(/boom/);
  });
});

describe("workspace_logs.listMissionsForWorkspace", () => {
  it("requires authentication", async () => {
    const t = convexTest(schema, modules);
    await seedInstance(t);

    await expect(
      t.query(api.workspace_logs.listMissionsForWorkspace, {
        instanceId: INSTANCE_ID,
        workspaceKey: WORKSPACE_KEY,
      }),
    ).rejects.toThrow(/Authentication required/i);
  });

  it("returns [] when no Agent owns this workspace yet", async () => {
    const t = convexTest(schema, modules);
    await seedInstance(t);

    const result = await t.withIdentity(OWNER).query(api.workspace_logs.listMissionsForWorkspace, {
      instanceId: INSTANCE_ID,
      workspaceKey: WORKSPACE_KEY,
    });

    expect(result).toEqual([]);
  });

  it("lists only Missions belonging to this Workspace's Agent, not the whole Project", async () => {
    const t = convexTest(schema, modules);
    await seedInstance(t);
    await seedProjectAgent(t);
    await seedProjectAgent(t, {
      workspaceKey: "ws-other",
      openclawAgentName: "other-agent",
      templateId: "other-template",
    });
    const ownMissionId = await seedMission(t, { name: "Mine" });
    await seedMission(t, { name: "Not mine", templateId: "other-template" });

    const result = await t.withIdentity(OWNER).query(api.workspace_logs.listMissionsForWorkspace, {
      instanceId: INSTANCE_ID,
      workspaceKey: WORKSPACE_KEY,
    });

    expect(result).toHaveLength(1);
    expect(result[0]?._id).toBe(ownMissionId);
    expect(result[0]?.name).toBe("Mine");
  });
});

describe("workspace_logs.listRunsForMission", () => {
  it("lists Runs for a Mission without exposing sessionKey", async () => {
    const t = convexTest(schema, modules);
    await seedInstance(t);
    await seedProjectAgent(t);
    const missionId = await seedMission(t);
    const runId = await seedRun(t, missionId, { sessionKey: "mega-run-secret", createdAt: 1000 });

    const result = await t.withIdentity(OWNER).query(api.workspace_logs.listRunsForMission, {
      missionId,
    });

    expect(result).toHaveLength(1);
    expect(result[0]?._id).toBe(runId);
    expect(JSON.stringify(result)).not.toContain("mega-run-secret");
    expect(result[0]).not.toHaveProperty("sessionKey");
  });

  it("returns [] for a Mission owned by another user", async () => {
    const t = convexTest(schema, modules);
    await seedInstance(t);
    await seedProjectAgent(t);
    const missionId = await seedMission(t);
    await seedRun(t, missionId, { sessionKey: "mega-run-1", createdAt: 1000 });

    const result = await t.withIdentity(OTHER).query(api.workspace_logs.listRunsForMission, {
      missionId,
    });

    expect(result).toEqual([]);
  });
});

async function seedSourceJob(
  t: ReturnType<typeof convexTest>,
  opts: { ownerId?: string; templateId?: string; lastOutcome?: "failed" | "succeeded"; lastError?: string } = {},
): Promise<Id<"jobs">> {
  const now = Date.now();
  return await t.run(async (ctx) => {
    return await ctx.db.insert("jobs", {
      ownerId: opts.ownerId ?? OWNER.subject,
      instanceId: INSTANCE_ID,
      templateId: opts.templateId ?? TEMPLATE_ID,
      type: "source_ingestion",
      state: "active",
      unit: "daily",
      hour: 6,
      minute: 0,
      timezone: "UTC",
      nextRunAt: now,
      config: {},
      runtime: { cursorAt: 0 },
      lastOutcome: opts.lastOutcome,
      lastError: opts.lastError,
      createdAt: now,
      updatedAt: now,
    });
  });
}

async function seedGenericJob(
  t: ReturnType<typeof convexTest>,
  type: "source_ingestion" | "source_scoring" | "source_routing",
): Promise<Id<"jobs">> {
  const now = Date.now();
  return await t.run((ctx) => ctx.db.insert("jobs", {
    ownerId: OWNER.subject,
    instanceId: INSTANCE_ID,
    templateId: TEMPLATE_ID,
    type,
    state: "active",
    config: {},
    runtime: {},
    unit: "daily",
    hour: 6,
    minute: 0,
    timezone: "UTC",
    nextRunAt: now,
    createdAt: now,
    updatedAt: now,
  }));
}

async function seedJobRun(
  t: ReturnType<typeof convexTest>,
  jobId: Id<"jobs">,
  opts: { sessionKey: string; createdAt: number; errorMessage?: string },
): Promise<Id<"runs">> {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("runs", {
      jobId,
      ownerId: OWNER.subject,
      instanceId: INSTANCE_ID,
      templateId: TEMPLATE_ID,
      agentName: AGENT_NAME,
      sessionKey: opts.sessionKey,
      status: opts.errorMessage ? "failed" : "completed",
      errorMessage: opts.errorMessage,
      createdAt: opts.createdAt,
      updatedAt: opts.createdAt,
    });
  });
}

describe("workspace_logs.listJobsForWorkspace", () => {
  it("lists all generic Source Jobs with responsibility labels", async () => {
    const t = convexTest(schema, modules);
    await seedInstance(t);
    await seedProjectAgent(t);
    await seedGenericJob(t, "source_ingestion");
    await seedGenericJob(t, "source_scoring");
    await seedGenericJob(t, "source_routing");

    const result = await t.withIdentity(OWNER).query(api.workspace_logs.listJobsForWorkspace, {
      instanceId: INSTANCE_ID,
      workspaceKey: WORKSPACE_KEY,
    });

    expect(result.map((job) => job.agentName)).toEqual([
      "Social source ingestion",
      "Source scoring",
      "Source routing",
    ]);
    expect(result.map((job) => job.jobType)).toEqual([
      "source_ingestion",
      "source_scoring",
      "source_routing",
    ]);
  });

  it("lists the Agent's job with its last outcome and error, and no other Agent's", async () => {
    const t = convexTest(schema, modules);
    await seedInstance(t);
    await seedProjectAgent(t);
    const jobId = await seedSourceJob(t, { lastOutcome: "failed", lastError: "2 Sources invalid" });
    await seedSourceJob(t, { templateId: "other-template" });

    const result = await t.withIdentity(OWNER).query(api.workspace_logs.listJobsForWorkspace, {
      instanceId: INSTANCE_ID,
      workspaceKey: WORKSPACE_KEY,
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ _id: jobId, lastOutcome: "failed", lastError: "2 Sources invalid" });
  });

  it("never exposes the session identifier of the job's Runs", async () => {
    const t = convexTest(schema, modules);
    await seedInstance(t);
    await seedProjectAgent(t);
    const jobId = await seedSourceJob(t);
    await seedJobRun(t, jobId, { sessionKey: "mega-job-secret-listing", createdAt: 1000 });

    const result = await t.withIdentity(OWNER).query(api.workspace_logs.listJobsForWorkspace, {
      instanceId: INSTANCE_ID,
      workspaceKey: WORKSPACE_KEY,
    });

    expect(JSON.stringify(result)).not.toContain("mega-job-secret-listing");
  });

  it("lists only the caller's job when the same Agent has one per owner", async () => {
    const t = convexTest(schema, modules);
    await seedInstance(t);
    await seedProjectAgent(t);
    const mine = await seedSourceJob(t);
    await seedSourceJob(t, { ownerId: OTHER.subject });

    const result = await t.withIdentity(OWNER).query(api.workspace_logs.listJobsForWorkspace, {
      instanceId: INSTANCE_ID,
      workspaceKey: WORKSPACE_KEY,
    });

    expect(result.map((job) => job._id)).toEqual([mine]);
  });

  it("returns [] for a user who does not own the instance", async () => {
    const t = convexTest(schema, modules);
    await seedInstance(t);
    await seedProjectAgent(t);
    await seedSourceJob(t);

    const result = await t.withIdentity(OTHER).query(api.workspace_logs.listJobsForWorkspace, {
      instanceId: INSTANCE_ID,
      workspaceKey: WORKSPACE_KEY,
    });

    expect(result).toEqual([]);
  });
});

describe("workspace_logs.listRunsForJob", () => {
  it("lists a job's Runs newest first with status, date and error, without sessionKey", async () => {
    const t = convexTest(schema, modules);
    await seedInstance(t);
    await seedProjectAgent(t);
    const jobId = await seedSourceJob(t);
    const older = await seedJobRun(t, jobId, { sessionKey: "mega-job-secret-1", createdAt: 1000 });
    const newer = await seedJobRun(t, jobId, {
      sessionKey: "mega-job-secret-2",
      createdAt: 2000,
      errorMessage: "invalid Sources",
    });

    const result = await t.withIdentity(OWNER).query(api.workspace_logs.listRunsForJob, { jobId });

    expect(result.map((run) => run._id)).toEqual([newer, older]);
    expect(result[0]).toMatchObject({ status: "failed", errorMessage: "invalid Sources", createdAt: 2000 });
    expect(JSON.stringify(result)).not.toContain("mega-job-secret");
    expect(result[0]).not.toHaveProperty("sessionKey");
  });

  it("returns [] for a job owned by another user", async () => {
    const t = convexTest(schema, modules);
    await seedInstance(t);
    await seedProjectAgent(t);
    const jobId = await seedSourceJob(t);
    await seedJobRun(t, jobId, { sessionKey: "mega-job-1", createdAt: 1000 });

    const result = await t.withIdentity(OTHER).query(api.workspace_logs.listRunsForJob, { jobId });

    expect(result).toEqual([]);
  });

  it("reads a job Run's transcript through the same action as a Mission Run", async () => {
    const t = convexTest(schema, modules);
    await seedInstance(t);
    await seedProjectAgent(t);
    const jobId = await seedSourceJob(t);
    const runId = await seedJobRun(t, jobId, { sessionKey: "mega-job-1", createdAt: 1000 });

    const resultPromise = t.withIdentity(OWNER).action(api.workspace_logs_node.getWorkspaceRunTranscript, {
      instanceId: INSTANCE_ID,
      workspaceKey: WORKSPACE_KEY,
      runId,
    });
    await simulateSessionTranscriptResult(t, {
      found: true,
      turns: [{ kind: "message", role: "assistant", text: "read the batch" }],
    });
    const result = await resultPromise;

    expect(result).toMatchObject({ found: true, runId, parent: { kind: "job", jobId } });
    expect(result.turns).toHaveLength(1);
  });
});
