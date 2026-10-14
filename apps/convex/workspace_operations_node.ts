"use node";

import { action, type ActionCtx } from "./_generated/server.js";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel.js";
import {
  RUNTIME_WORKSPACE_FILE_READ,
  RUNTIME_WORKSPACE_LIST,
  RUNTIME_WORKSPACE_SKILL_FILES,
  type RuntimeWorkspaceFileEntry,
  type RuntimeWorkspaceDescriptor,
} from "@opengroow/protocol";
import { internal } from "./_generated/api.js";
import {
  enqueueInteractiveCommand,
  waitForRuntimeEvent,
  type RuntimeResultQueryResult,
} from "./runtime_commands_node.js";
import {
  parseRuntimeWorkspaceFileReadPayload,
  parseRuntimeWorkspaceListPayload,
  parseRuntimeWorkspaceSkillFilesPayload,
} from "./runtime_commands_node_parsers.js";
import { requireOwnerOfInstance } from "./instance_ownership.js";

const WORKSPACE_FILE_READ_TIMEOUT_MS = 30_000;
const WORKSPACE_OPERATION_TIMEOUT_MS = 30_000;

export type WorkspaceListResult =
  | { workspaces: RuntimeWorkspaceDescriptor[] }
  | { error: string };

export type WorkspaceSkillFilesResult =
  | { workspaceKey: string; spec: string; files: RuntimeWorkspaceFileEntry[] }
  | { error: string };

type WorkspaceOperationDispatchResult = {
  status: number;
  accepted: boolean;
  commandId?: Id<"commands">;
  error?: string;
};

export type WorkspaceOperationDependencies = {
  dispatch: (args: {
    instanceId: string;
    type: typeof RUNTIME_WORKSPACE_LIST | typeof RUNTIME_WORKSPACE_SKILL_FILES;
    payload: Record<string, string>;
  }) => Promise<WorkspaceOperationDispatchResult>;
  wait: (
    instanceId: string,
    commandId: Id<"commands">,
    timeoutMs: number,
  ) => Promise<RuntimeResultQueryResult>;
};

async function dispatchAndWait(
  dependencies: WorkspaceOperationDependencies,
  args: {
    instanceId: string;
    type: typeof RUNTIME_WORKSPACE_LIST | typeof RUNTIME_WORKSPACE_SKILL_FILES;
    payload: Record<string, string>;
  },
) {
  const dispatch = await dependencies.dispatch(args);
  if (!dispatch.accepted || !dispatch.commandId) {
    return {
      result: null,
      commandId: undefined,
      error: dispatch.error ?? "Workspace operation dispatch failed",
    };
  }
  const brokerResult = await dependencies.wait(
    args.instanceId,
    dispatch.commandId,
    WORKSPACE_OPERATION_TIMEOUT_MS,
  );
  if (!brokerResult.found) {
    return {
      result: null,
      commandId: dispatch.commandId,
      error:
        brokerResult.status === 500
          ? "Workspace operation dispatch failed"
          : "Workspace operation timed out",
    };
  }
  return { result: brokerResult, commandId: dispatch.commandId, error: null };
}

export async function listWorkspacesWith(
  dependencies: WorkspaceOperationDependencies,
  instanceId: string,
): Promise<WorkspaceListResult> {
  const normalizedInstanceId = instanceId.trim();
  if (!normalizedInstanceId) return { error: "instanceId is required" };
  const response = await dispatchAndWait(dependencies, {
    instanceId: normalizedInstanceId,
    type: RUNTIME_WORKSPACE_LIST,
    payload: {},
  });
  if (response.error) return { error: response.error };
  if (!response.result || !response.commandId) {
    return { error: "Workspace list returned no runtime result" };
  }

  const parsed = parseRuntimeWorkspaceListPayload(
    response.result.type,
    response.result.payload,
  );
  if (!parsed || parsed.commandId !== response.commandId) {
    return { error: "Workspace list returned an invalid payload" };
  }
  if (!parsed.ok) return { error: parsed.error ?? "Failed to load workspaces" };
  if (parsed.instanceId !== normalizedInstanceId) {
    return { error: "Workspace list returned an invalid payload" };
  }
  return { workspaces: parsed.data.workspaces };
}

export async function listSkillFilesWith(
  dependencies: WorkspaceOperationDependencies,
  args: { instanceId: string; workspaceKey: string; spec: string },
): Promise<WorkspaceSkillFilesResult> {
  const instanceId = args.instanceId.trim();
  const workspaceKey = args.workspaceKey.trim();
  const spec = args.spec.trim();
  if (!instanceId || !workspaceKey || !spec) {
    return { error: "instanceId, workspaceKey and spec are required" };
  }
  const response = await dispatchAndWait(dependencies, {
    instanceId,
    type: RUNTIME_WORKSPACE_SKILL_FILES,
    payload: { workspaceKey, spec },
  });
  if (response.error) return { error: response.error };
  if (!response.result || !response.commandId) {
    return { error: "Workspace skill files returned no runtime result" };
  }

  const parsed = parseRuntimeWorkspaceSkillFilesPayload(
    response.result.type,
    response.result.payload,
  );
  if (!parsed || parsed.instanceId !== instanceId) {
    return { error: "Workspace skill files returned an invalid payload" };
  }
  if (!parsed.ok) return { error: parsed.error ?? "Failed to load skill files" };
  if (parsed.data.workspaceKey !== workspaceKey || parsed.data.spec !== spec) {
    return { error: "Workspace skill files returned an invalid payload" };
  }
  return parsed.data;
}

export type WorkspaceFileReadResult =
  | {
      found: true;
      workspaceKey: string;
      filePath: string;
      title: string;
      content: string;
      lastModifiedAt?: string;
    }
  | {
      found: false;
      error: string;
    };

type WorkspaceFileReadDispatchResult = {
  status: number;
  accepted: boolean;
  commandId?: Id<"commands">;
  error?: string;
};

export type WorkspaceFileReadDependencies = {
  dispatch: (args: {
    instanceId: string;
    type: typeof RUNTIME_WORKSPACE_FILE_READ;
    payload: { workspaceKey: string; filePath: string };
  }) => Promise<WorkspaceFileReadDispatchResult>;
  wait: (
    instanceId: string,
    commandId: Id<"commands">,
    timeoutMs: number,
  ) => Promise<RuntimeResultQueryResult>;
};

type ReadWorkspaceFileArgs = {
  instanceId: string;
  workspaceKey: string;
  filePath: string;
  /** Defaults to `WORKSPACE_FILE_READ_TIMEOUT_MS`. Lets a best-effort,
   * non-interactive caller (e.g. the Observations pull, issue #408) request a
   * shorter wait than an interactive dashboard read without having to shadow
   * `dependencies.wait`'s own `timeoutMs` parameter. */
  timeoutMs?: number;
};

export async function readWorkspaceFileWith(
  dependencies: WorkspaceFileReadDependencies,
  args: ReadWorkspaceFileArgs,
): Promise<WorkspaceFileReadResult> {
  const instanceId = args.instanceId.trim();
  const workspaceKey = args.workspaceKey.trim();
  const filePath = args.filePath.trim();
  if (!instanceId || !workspaceKey || !filePath) {
    return {
      found: false,
      error: "instanceId, workspaceKey and filePath are required",
    };
  }

  const dispatch = await dependencies.dispatch({
    instanceId,
    type: RUNTIME_WORKSPACE_FILE_READ,
    payload: { workspaceKey, filePath },
  });
  if (!dispatch.accepted || !dispatch.commandId) {
    return {
      found: false,
      error: dispatch.error ?? "Workspace file read dispatch failed",
    };
  }

  const brokerResult = await dependencies.wait(
    instanceId,
    dispatch.commandId,
    args.timeoutMs ?? WORKSPACE_FILE_READ_TIMEOUT_MS,
  );
  if (!brokerResult.found) {
    return {
      found: false,
      error:
        brokerResult.status === 500
          ? "Workspace file read dispatch failed"
          : "Workspace file read timed out",
    };
  }

  const parsed = parseRuntimeWorkspaceFileReadPayload(
    brokerResult.type,
    brokerResult.payload,
  );
  if (
    !parsed ||
    parsed.commandId !== dispatch.commandId ||
    parsed.instanceId !== instanceId
  ) {
    return {
      found: false,
      error: "Workspace file read returned an invalid payload",
    };
  }
  if (
    parsed.data.workspaceKey !== workspaceKey ||
    parsed.data.filePath !== filePath
  ) {
    return {
      found: false,
      error: "Workspace file read returned an invalid payload",
    };
  }
  if (!parsed.ok) {
    return { found: false, error: parsed.error ?? "Workspace file read failed" };
  }

  return {
    found: true,
    ...parsed.data,
  };
}

export const readWorkspaceFile = action({
  args: {
    instanceId: v.string(),
    workspaceKey: v.string(),
    filePath: v.string(),
  },
  handler: async (ctx: ActionCtx, args): Promise<WorkspaceFileReadResult> => {
    await requireOwnerOfInstance(ctx, args.instanceId);

    return await readWorkspaceFileWith(
      {
        dispatch: (dispatchArgs) => enqueueInteractiveCommand(ctx, dispatchArgs),
        wait: (instanceId, commandId, timeoutMs) =>
          waitForRuntimeEvent(ctx, instanceId, commandId, timeoutMs),
      },
      args,
    );
  },
});

export const listWorkspaces = action({
  args: { instanceId: v.string() },
  handler: async (
    ctx: ActionCtx,
    args,
  ): Promise<WorkspaceListResult> => {
    await requireOwnerOfInstance(ctx, args.instanceId);
    const result = await listWorkspacesWith(
      {
        dispatch: (dispatchArgs) => enqueueInteractiveCommand(ctx, dispatchArgs),
        wait: (instanceId, commandId, timeoutMs) =>
          waitForRuntimeEvent(ctx, instanceId, commandId, timeoutMs),
      },
      args.instanceId,
    );
    if ("error" in result) return result;

    await ctx.runMutation(internal.instances.setWorkspaceListByOpenclawId, {
      openclawId: args.instanceId,
      workspaces: result.workspaces,
      updatedAt: new Date().toISOString(),
    });
    return result;
  },
});

export const listSkillFiles = action({
  args: {
    instanceId: v.string(),
    workspaceKey: v.string(),
    spec: v.string(),
  },
  handler: async (
    ctx: ActionCtx,
    args,
  ): Promise<WorkspaceSkillFilesResult> => {
    await requireOwnerOfInstance(ctx, args.instanceId);
    return await listSkillFilesWith(
      {
        dispatch: (dispatchArgs) => enqueueInteractiveCommand(ctx, dispatchArgs),
        wait: (instanceId, commandId, timeoutMs) =>
          waitForRuntimeEvent(ctx, instanceId, commandId, timeoutMs),
      },
      args,
    );
  },
});
