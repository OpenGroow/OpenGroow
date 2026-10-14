import {
  RUNTIME_WORKSPACE_CREATE_RESULT,
  RUNTIME_WORKSPACE_FILE_DELETE_RESULT,
  RUNTIME_WORKSPACE_FILE_DELETE_BATCH_RESULT,
  RUNTIME_WORKSPACE_FILE_READ_RESULT,
  RUNTIME_WORKSPACE_FILE_WRITE_RESULT,
  RUNTIME_WORKSPACE_LIST_RESULT,
  RUNTIME_WORKSPACE_SKILL_FILES_RESULT,
  type RuntimeWorkspaceKind,
} from "@opengroow/protocol";
import {
  readWorkspaceFileContent,
  readWorkspaceFilePath,
  readWorkspaceKey,
  readWorkspaceLabel,
  readWorkspaceSkillSpec,
} from "./command-inputs.js";
import { createEventMessage } from "./event-message.js";
import type { CommandHandler } from "./types.js";

export const handleWorkspaceList: CommandHandler = async (command, deps) => {
  try {
    const result = await deps.gatewayClient.requestGatewayControl<{
      workspaces: Array<{
        workspaceKey: string;
        label: string;
        absolutePath: string;
        isActive: boolean;
        kind: RuntimeWorkspaceKind;
        availableFiles: Array<{
          filePath: string;
          title: string;
          kind: "standard" | "memory";
        }>;
      }>;
    }>("/workspace/list", {});
    return createEventMessage(RUNTIME_WORKSPACE_LIST_RESULT, command.id, {
      commandId: command.id,
      instanceId: deps.getRuntimeInstanceId(),
      ok: true,
      data: {
        workspaces: result.workspaces,
      },
    });
  } catch (error) {
    return createEventMessage(RUNTIME_WORKSPACE_LIST_RESULT, command.id, {
      commandId: command.id,
      instanceId: deps.getRuntimeInstanceId(),
      ok: false,
      error:
        error instanceof Error ? error.message : "Failed to list workspaces",
      data: {
        workspaces: [],
      },
    });
  }
};

export const handleWorkspaceFileRead: CommandHandler = async (command, deps) => {
  const workspaceKey = readWorkspaceKey(command.payload);
  const filePath = readWorkspaceFilePath(command.payload);

  if (!workspaceKey || !filePath) {
    return createEventMessage(RUNTIME_WORKSPACE_FILE_READ_RESULT, command.id, {
      commandId: command.id,
      instanceId: deps.getRuntimeInstanceId(),
      ok: false,
      error: "workspaceKey and filePath are required",
      data: {
        workspaceKey,
        filePath,
        title: "",
        content: "",
      },
    });
  }

  try {
    const result = await deps.gatewayClient.requestGatewayControl<{
      workspaceKey: string;
      filePath: string;
      title: string;
      content: string;
      lastModifiedAt?: string;
    }>("/workspace/file", {
      workspaceKey,
      filePath,
    });

    return createEventMessage(RUNTIME_WORKSPACE_FILE_READ_RESULT, command.id, {
      commandId: command.id,
      instanceId: deps.getRuntimeInstanceId(),
      ok: true,
      data: {
        workspaceKey: result.workspaceKey,
        filePath: result.filePath,
        title: result.title,
        content: result.content,
        lastModifiedAt: result.lastModifiedAt,
      },
    });
  } catch (error) {
    return createEventMessage(RUNTIME_WORKSPACE_FILE_READ_RESULT, command.id, {
      commandId: command.id,
      instanceId: deps.getRuntimeInstanceId(),
      ok: false,
      error:
        error instanceof Error ? error.message : "Failed to read workspace file",
      data: {
        workspaceKey,
        filePath,
        title: "",
        content: "",
      },
    });
  }
};

export const handleWorkspaceSkillFiles: CommandHandler = async (
  command,
  deps,
) => {
  const workspaceKey = readWorkspaceKey(command.payload);
  const spec = readWorkspaceSkillSpec(command.payload);

  if (!workspaceKey || !spec) {
    return createEventMessage(RUNTIME_WORKSPACE_SKILL_FILES_RESULT, command.id, {
      commandId: command.id,
      instanceId: deps.getRuntimeInstanceId(),
      ok: false,
      error: "workspaceKey and spec are required",
      data: { workspaceKey, spec, files: [] },
    });
  }

  try {
    const result = await deps.gatewayClient.requestGatewayControl<{
      workspaceKey: string;
      spec: string;
      files: Array<{ filePath: string; title: string; kind: "skill" }>;
    }>("/workspace/skill/files", { workspaceKey, spec });

    return createEventMessage(RUNTIME_WORKSPACE_SKILL_FILES_RESULT, command.id, {
      commandId: command.id,
      instanceId: deps.getRuntimeInstanceId(),
      ok: true,
      data: {
        workspaceKey: result.workspaceKey,
        spec: result.spec,
        files: result.files,
      },
    });
  } catch (error) {
    return createEventMessage(RUNTIME_WORKSPACE_SKILL_FILES_RESULT, command.id, {
      commandId: command.id,
      instanceId: deps.getRuntimeInstanceId(),
      ok: false,
      error:
        error instanceof Error ? error.message : "Failed to list skill files",
      data: { workspaceKey, spec, files: [] },
    });
  }
};

export const handleWorkspaceCreate: CommandHandler = async (command, deps) => {
  const workspaceKey = readWorkspaceKey(command.payload);
  const label = readWorkspaceLabel(command.payload);

  if (!workspaceKey || !label) {
    return createEventMessage(RUNTIME_WORKSPACE_CREATE_RESULT, command.id, {
      commandId: command.id,
      instanceId: deps.getRuntimeInstanceId(),
      ok: false,
      error: "workspaceKey and label are required",
      data: { workspaceKey, label },
    });
  }

  try {
    const result = await deps.gatewayClient.requestGatewayControl<{
      workspaceKey: string;
      label: string;
      absolutePath?: string;
    }>("/workspace/create", { workspaceKey, label });

    return createEventMessage(RUNTIME_WORKSPACE_CREATE_RESULT, command.id, {
      commandId: command.id,
      instanceId: deps.getRuntimeInstanceId(),
      ok: true,
      data: {
        workspaceKey: result.workspaceKey,
        label: result.label,
        ...(result.absolutePath ? { absolutePath: result.absolutePath } : {}),
      },
    });
  } catch (error) {
    return createEventMessage(RUNTIME_WORKSPACE_CREATE_RESULT, command.id, {
      commandId: command.id,
      instanceId: deps.getRuntimeInstanceId(),
      ok: false,
      error:
        error instanceof Error ? error.message : "Failed to create workspace",
      data: { workspaceKey, label },
    });
  }
};

export const handleWorkspaceFileDelete: CommandHandler = async (command, deps) => {
  const workspaceKey = readWorkspaceKey(command.payload);
  const filePath = readWorkspaceFilePath(command.payload);

  if (!workspaceKey || !filePath) {
    return createEventMessage(RUNTIME_WORKSPACE_FILE_DELETE_RESULT, command.id, {
      commandId: command.id,
      instanceId: deps.getRuntimeInstanceId(),
      ok: false,
      error: "workspaceKey and filePath are required",
      data: { workspaceKey, filePath, deleted: false },
    });
  }

  try {
    const result = await deps.gatewayClient.requestGatewayControl<{
      workspaceKey: string;
      filePath: string;
      deleted: boolean;
    }>("/workspace/file/delete", { workspaceKey, filePath });

    return createEventMessage(RUNTIME_WORKSPACE_FILE_DELETE_RESULT, command.id, {
      commandId: command.id,
      instanceId: deps.getRuntimeInstanceId(),
      ok: true,
      data: result,
    });
  } catch (error) {
    return createEventMessage(RUNTIME_WORKSPACE_FILE_DELETE_RESULT, command.id, {
      commandId: command.id,
      instanceId: deps.getRuntimeInstanceId(),
      ok: false,
      error: error instanceof Error ? error.message : "Failed to delete workspace file",
      data: { workspaceKey, filePath, deleted: false },
    });
  }
};

export const handleWorkspaceFileDeleteBatch: CommandHandler = async (command, deps) => {
  const workspaceKey = readWorkspaceKey(command.payload);
  const filePaths = (command.payload as Record<string, unknown> | undefined)?.filePaths as string[] | undefined;

  if (!workspaceKey || !filePaths || !Array.isArray(filePaths) || filePaths.length === 0) {
    return createEventMessage(RUNTIME_WORKSPACE_FILE_DELETE_BATCH_RESULT, command.id, {
      commandId: command.id,
      instanceId: deps.getRuntimeInstanceId(),
      ok: false,
      error: "workspaceKey and filePaths (non-empty array) are required",
      data: { workspaceKey, results: [] },
    });
  }

  const results: Array<{ filePath: string; ok: boolean; error?: string }> = [];
  for (const filePath of filePaths) {
    try {
      const result = await deps.gatewayClient.requestGatewayControl<{
        workspaceKey: string;
        filePath: string;
        deleted: boolean;
      }>("/workspace/file/delete", { workspaceKey, filePath });
      results.push({ filePath, ok: result.deleted });
    } catch (error) {
      results.push({
        filePath,
        ok: false,
        error: error instanceof Error ? error.message : "Failed to delete workspace file",
      });
    }
  }

  const allOk = results.every((r) => r.ok);
  return createEventMessage(RUNTIME_WORKSPACE_FILE_DELETE_BATCH_RESULT, command.id, {
    commandId: command.id,
    instanceId: deps.getRuntimeInstanceId(),
    ok: allOk,
    error: allOk ? undefined : `Failed to delete ${results.filter((r) => !r.ok).length} file(s)`,
    data: { workspaceKey, results },
  });
};

export const handleWorkspaceFileWrite: CommandHandler = async (
  command,
  deps,
) => {
  const workspaceKey = readWorkspaceKey(command.payload);
  const filePath = readWorkspaceFilePath(command.payload);
  const content = readWorkspaceFileContent(command.payload);

  if (!workspaceKey || !filePath || content === undefined) {
    return createEventMessage(
      RUNTIME_WORKSPACE_FILE_WRITE_RESULT,
      command.id,
      {
        commandId: command.id,
        instanceId: deps.getRuntimeInstanceId(),
        ok: false,
        error: "workspaceKey, filePath, and content are required",
        data: { workspaceKey, filePath },
      },
    );
  }

  try {
    const result = await deps.gatewayClient.requestGatewayControl<{
      workspaceKey: string;
      filePath: string;
    }>("/workspace/file/write", { workspaceKey, filePath, content });

    return createEventMessage(
      RUNTIME_WORKSPACE_FILE_WRITE_RESULT,
      command.id,
      {
        commandId: command.id,
        instanceId: deps.getRuntimeInstanceId(),
        ok: true,
        data: { workspaceKey: result.workspaceKey, filePath: result.filePath },
      },
    );
  } catch (error) {
    return createEventMessage(
      RUNTIME_WORKSPACE_FILE_WRITE_RESULT,
      command.id,
      {
        commandId: command.id,
        instanceId: deps.getRuntimeInstanceId(),
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to write workspace file",
        data: { workspaceKey, filePath },
      },
    );
  }
};
