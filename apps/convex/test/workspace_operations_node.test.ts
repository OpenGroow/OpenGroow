import { insertInstance } from "./instance_fixture";
import { describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import { api } from "../_generated/api";
import schema from "../schema";
import type { Id } from "../_generated/dataModel";
import {
  RUNTIME_WORKSPACE_FILE_READ_RESULT,
  buildRuntimeResultEventId,
} from "@opengroow/protocol";
import {
  listSkillFilesWith,
  listWorkspacesWith,
  readWorkspaceFileWith,
  type WorkspaceFileReadDependencies,
  type WorkspaceOperationDependencies,
} from "../workspace_operations_node";

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
  "../instances_node.ts": () => import("../instances_node.js"),
  "../runtime_commands_node.ts": () => import("../runtime_commands_node.js"),
  "../workspace_operations_node.ts": () => import("../workspace_operations_node.js"),
};

const INSTANCE_ID = "openclaw-instance-workspace-1";
const WORKSPACE_KEY = "ws-hello";
const FILE_PATH = "AGENTS.md";
const OWNER = {
  name: "Owner",
  email: "owner@example.com",
  tokenIdentifier: "test|workspace-owner",
  subject: "workspace-owner",
};

const commandId = "command-workspace-file-1" as Id<"commands">;

function validResult(overrides: Record<string, unknown> = {}) {
  return {
    commandId,
    instanceId: INSTANCE_ID,
    ok: true,
    data: {
      workspaceKey: WORKSPACE_KEY,
      filePath: FILE_PATH,
      title: "AGENTS",
      content: "# Agents",
    },
    ...overrides,
  };
}

function fakeDependencies(
  result: { type?: string; payload?: unknown; status?: number; found?: boolean },
): WorkspaceFileReadDependencies {
  return {
    dispatch: async () => ({ status: 202, accepted: true, commandId }),
    wait: async () => ({
      status: result.status ?? 200,
      found: result.found ?? true,
      type: result.type,
      payload: result.payload,
    }),
  };
}

async function seedInstance(t: ReturnType<typeof convexTest>) {
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
  });
}

async function simulateFileResult(
  t: ReturnType<typeof convexTest>,
  payload: unknown | ((command: { _id: string; instanceId: string }) => unknown),
  type = RUNTIME_WORKSPACE_FILE_READ_RESULT,
) {
  const deadline = Date.now() + 5_000;
  let command: { _id: string; instanceId: string } | null = null;
  while (Date.now() < deadline) {
    command = await t.run(async (ctx) => {
      const commands = await ctx.db
        .query("commands")
        .filter((q) => q.eq(q.field("type"), "runtime.workspace.file.read"))
        .collect();
      return commands[commands.length - 1] ?? null;
    });
    if (command) break;
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
  }
  if (!command) throw new Error("Timed out waiting for workspace file command");

  await t.run(async (ctx) => {
    const now = Date.now();
    await ctx.db.insert("events", {
      instanceId: command!.instanceId,
      eventId: buildRuntimeResultEventId(command!._id),
      type,
      payload: typeof payload === "function" ? payload(command!) : payload,
      ts: now,
      createdAt: now,
    });
  });
}

describe("readWorkspaceFileWith", () => {
  it("returns only the typed file result after a matching runtime event", async () => {
    const result = await readWorkspaceFileWith(
      fakeDependencies({
        type: RUNTIME_WORKSPACE_FILE_READ_RESULT,
        payload: validResult(),
      }),
      { instanceId: INSTANCE_ID, workspaceKey: WORKSPACE_KEY, filePath: FILE_PATH },
    );

    expect(result).toEqual({
      found: true,
      workspaceKey: WORKSPACE_KEY,
      filePath: FILE_PATH,
      title: "AGENTS",
      content: "# Agents",
    });
  });

  it.each([
    ["wrong event family", { type: "runtime.workspace.list.result", payload: validResult() }],
    ["malformed payload", { type: RUNTIME_WORKSPACE_FILE_READ_RESULT, payload: { ok: true } }],
    ["wrong requested file", {
      type: RUNTIME_WORKSPACE_FILE_READ_RESULT,
      payload: validResult({ data: { ...validResult().data, filePath: "NOTES.md" } }),
    }],
  ])("rejects %s without exposing the raw runtime result", async (_label, response) => {
    await expect(
      readWorkspaceFileWith(
        fakeDependencies(response),
        { instanceId: INSTANCE_ID, workspaceKey: WORKSPACE_KEY, filePath: FILE_PATH },
      ),
    ).resolves.toEqual({
      found: false,
      error: "Workspace file read returned an invalid payload",
    });
  });

  it("maps dispatch refusal and timeout to business errors", async () => {
    const refused: WorkspaceFileReadDependencies = {
      dispatch: async () => ({
        status: 503,
        accepted: false,
        error: "runtime unavailable",
      }),
      wait: async () => {
        throw new Error("wait should not run after dispatch refusal");
      },
    };
    await expect(
      readWorkspaceFileWith(refused, {
        instanceId: INSTANCE_ID,
        workspaceKey: WORKSPACE_KEY,
        filePath: FILE_PATH,
      }),
    ).resolves.toEqual({ found: false, error: "runtime unavailable" });

    await expect(
      readWorkspaceFileWith(
        fakeDependencies({ status: 504, found: false }),
        { instanceId: INSTANCE_ID, workspaceKey: WORKSPACE_KEY, filePath: FILE_PATH },
      ),
    ).resolves.toEqual({ found: false, error: "Workspace file read timed out" });
  });

  it("returns a runtime business error when the file is absent", async () => {
    await expect(
      readWorkspaceFileWith(
        fakeDependencies({
          type: RUNTIME_WORKSPACE_FILE_READ_RESULT,
          payload: validResult({ ok: false, error: "File not found" }),
        }),
        { instanceId: INSTANCE_ID, workspaceKey: WORKSPACE_KEY, filePath: FILE_PATH },
      ),
    ).resolves.toEqual({ found: false, error: "File not found" });
  });
});

describe("workspace_operations_node.readWorkspaceFile", () => {
  it("dispatches, waits, and returns a typed result without command details", async () => {
    const t = convexTest(schema, modules);
    await seedInstance(t);

    const resultPromise = t.withIdentity(OWNER).action(api.workspace_operations_node.readWorkspaceFile, {
      instanceId: INSTANCE_ID,
      workspaceKey: WORKSPACE_KEY,
      filePath: FILE_PATH,
    });
    await simulateFileResult(t, (command: { _id: string; instanceId: string }) =>
      validResult({ commandId: command._id, instanceId: command.instanceId }),
    );

    await expect(resultPromise).resolves.toEqual({
      found: true,
      workspaceKey: WORKSPACE_KEY,
      filePath: FILE_PATH,
      title: "AGENTS",
      content: "# Agents",
    });
  });

  it("requires ownership before dispatching a workspace read", async () => {
    const t = convexTest(schema, modules);

    await expect(
      t.action(api.workspace_operations_node.readWorkspaceFile, {
        instanceId: INSTANCE_ID,
        workspaceKey: WORKSPACE_KEY,
        filePath: FILE_PATH,
      }),
    ).rejects.toThrow(/Authentication required/i);
  });
});

describe("workspace_operations_node workspace collection operations", () => {
  const operationCommandId = "command-workspace-operation-1" as Id<"commands">;

  function operationDependencies(
    type: string,
    payload: unknown,
  ): WorkspaceOperationDependencies {
    return {
      dispatch: async () => ({
        status: 202,
        accepted: true,
        commandId: operationCommandId,
      }),
      wait: async () => ({
        status: 200,
        found: true,
        type,
        payload,
      }),
    };
  }

  it("returns a typed workspace collection", async () => {
    await expect(
      listWorkspacesWith(
        operationDependencies("runtime.workspace.list.result", {
          commandId: operationCommandId,
          instanceId: INSTANCE_ID,
          ok: true,
          data: {
            workspaces: [
              {
                workspaceKey: WORKSPACE_KEY,
                label: "Hello",
                absolutePath: "/workspace/hello",
                isActive: true,
                kind: "default",
                availableFiles: [
                  { filePath: FILE_PATH, title: "AGENTS", kind: "standard" },
                ],
              },
            ],
          },
        }),
        INSTANCE_ID,
      ),
    ).resolves.toMatchObject({ workspaces: [{ workspaceKey: WORKSPACE_KEY }] });
  });

  it("accepts a managed workspace (agent-created, distinct from the default workspace)", async () => {
    await expect(
      listWorkspacesWith(
        operationDependencies("runtime.workspace.list.result", {
          commandId: operationCommandId,
          instanceId: INSTANCE_ID,
          ok: true,
          data: {
            workspaces: [
              {
                workspaceKey: WORKSPACE_KEY,
                label: "video",
                absolutePath: "/workspace/video",
                isActive: false,
                kind: "managed",
                availableFiles: [],
              },
            ],
          },
        }),
        INSTANCE_ID,
      ),
    ).resolves.toMatchObject({ workspaces: [{ workspaceKey: WORKSPACE_KEY, kind: "managed" }] });
  });

  it("rejects a workspace list read against a skill-files event (crossed family)", async () => {
    await expect(
      listWorkspacesWith(
        operationDependencies("runtime.workspace.skill_files.result", {
          commandId: operationCommandId,
          instanceId: INSTANCE_ID,
          ok: true,
          data: { workspaceKey: WORKSPACE_KEY, spec: "avoid-ai-writing", files: [] },
        }),
        INSTANCE_ID,
      ),
    ).resolves.toEqual({ error: "Workspace list returned an invalid payload" });
  });

  it("returns typed skill files and rejects a crossed event family", async () => {
    await expect(
      listSkillFilesWith(
        operationDependencies("runtime.workspace.skill_files.result", {
          commandId: operationCommandId,
          instanceId: INSTANCE_ID,
          ok: true,
          data: {
            workspaceKey: WORKSPACE_KEY,
            spec: "avoid-ai-writing",
            files: [{ filePath: "SKILL.md", title: "SKILL", kind: "skill" }],
          },
        }),
        { instanceId: INSTANCE_ID, workspaceKey: WORKSPACE_KEY, spec: "avoid-ai-writing" },
      ),
    ).resolves.toMatchObject({ files: [{ filePath: "SKILL.md" }] });

    await expect(
      listSkillFilesWith(
        operationDependencies("runtime.workspace.list.result", {}),
        { instanceId: INSTANCE_ID, workspaceKey: WORKSPACE_KEY, spec: "avoid-ai-writing" },
      ),
    ).resolves.toEqual({ error: "Workspace skill files returned an invalid payload" });
  });
});
