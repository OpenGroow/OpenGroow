export const RUNTIME_WORKSPACE_LIST = "runtime.workspace.list" as const;
export const RUNTIME_WORKSPACE_LIST_RESULT = "runtime.workspace.list.result" as const;
export const RUNTIME_WORKSPACE_FILE_READ = "runtime.workspace.file.read" as const;
export const RUNTIME_WORKSPACE_FILE_READ_RESULT =
  "runtime.workspace.file.read.result" as const;
export const RUNTIME_WORKSPACE_CREATE = "runtime.workspace.create" as const;
export const RUNTIME_WORKSPACE_CREATE_RESULT = "runtime.workspace.create.result" as const;
export const RUNTIME_WORKSPACE_FILE_WRITE = "runtime.workspace.file.write" as const;
export const RUNTIME_WORKSPACE_FILE_WRITE_RESULT = "runtime.workspace.file.write.result" as const;
export const RUNTIME_WORKSPACE_FILE_DELETE = "runtime.workspace.file.delete" as const;
export const RUNTIME_WORKSPACE_FILE_DELETE_RESULT = "runtime.workspace.file.delete.result" as const;
export const RUNTIME_WORKSPACE_SKILL_FILES = "runtime.workspace.skill_files" as const;
export const RUNTIME_WORKSPACE_SKILL_FILES_RESULT = "runtime.workspace.skill_files.result" as const;
export const RUNTIME_WORKSPACE_FILE_DELETE_BATCH = "runtime.workspace.file.delete_batch" as const;
export const RUNTIME_WORKSPACE_FILE_DELETE_BATCH_RESULT =
  "runtime.workspace.file.delete_batch.result" as const;
export const RUNTIME_SKILLS_INSTALL_BATCH = "runtime.skills.install_batch" as const;
export const RUNTIME_SKILLS_INSTALL_BATCH_RESULT = "runtime.skills.install_batch.result" as const;
export const RUNTIME_AGENT_REGISTER_AND_CONFIGURE = "runtime.agent.register_and_configure" as const;
export const RUNTIME_AGENT_REGISTER_AND_CONFIGURE_RESULT =
  "runtime.agent.register_and_configure.result" as const;

export type RuntimeWorkspaceListCommandPayload = {
  commandId?: string;
};

export type RuntimeWorkspaceFileReadCommandPayload = {
  commandId?: string;
  workspaceKey: string;
  filePath: string;
};

/**
 * Discriminator for the origin / lifecycle of an OpenClaw workspace.
 *
 * - **default** — the primary workspace automatically created for every
 *   Instance. Contains the Agent's root `AGENTS.md`, mission files, and
 *   mission directories.
 * - **profile** — a workspace backed by an OpenClaw profile (named
 *   configuration preset). Created when the user selects a non-default
 *   profile for the Instance.
 * - **legacy** — a workspace carried over from a previous Instance
 *   provisioning format. Still accepted by the gateway for backward
 *   compatibility but should not be created by new code.
 * - **custom** — a workspace explicitly created by the user via the
 *   `runtime.workspace.create` command (ad-hoc, not tied to a profile
 *   or template).
 * - **managed** — a workspace automatically created and owned by an
 *   Agent Template at activation time (e.g. `video`, `seo`,
 *   `social-engagement`). The template controls its lifecycle; the
 *   user cannot delete it manually.
 */
export type RuntimeWorkspaceKind = "default" | "profile" | "legacy" | "custom" | "managed";

export type RuntimeWorkspaceFileEntry = {
  filePath: string;
  title: string;
  kind: "standard" | "memory" | "mission" | "skill";
};

export type RuntimeWorkspaceDescriptor = {
  workspaceKey: string;
  label: string;
  absolutePath: string;
  isActive: boolean;
  kind: RuntimeWorkspaceKind;
  availableFiles: RuntimeWorkspaceFileEntry[];
};

export type RuntimeWorkspaceListResultPayload = {
  commandId: string;
  instanceId: string;
  ok: boolean;
  error?: string;
  data: {
    workspaces: RuntimeWorkspaceDescriptor[];
  };
};

export type RuntimeWorkspaceFileReadResultPayload = {
  commandId: string;
  instanceId: string;
  ok: boolean;
  error?: string;
  data: {
    workspaceKey: string;
    filePath: string;
    title: string;
    content: string;
    lastModifiedAt?: string;
  };
};

export type RuntimeWorkspaceCreateCommandPayload = {
  commandId?: string;
  workspaceKey: string;
  label: string;
};

export type RuntimeWorkspaceCreateResultPayload = {
  commandId: string;
  instanceId: string;
  ok: boolean;
  error?: string;
  data: {
    workspaceKey: string;
    label: string;
    absolutePath?: string;
  };
};

export type RuntimeWorkspaceFileWriteCommandPayload = {
  commandId?: string;
  workspaceKey: string;
  filePath: string;
  content: string;
};

export type RuntimeWorkspaceFileWriteResultPayload = {
  commandId: string;
  instanceId: string;
  ok: boolean;
  error?: string;
  data: {
    workspaceKey: string;
    filePath: string;
  };
};

export type RuntimeWorkspaceFileDeleteCommandPayload = {
  commandId?: string;
  workspaceKey: string;
  filePath: string;
};

export type RuntimeWorkspaceFileDeleteResultPayload = {
  commandId: string;
  instanceId: string;
  ok: boolean;
  error?: string;
  data: {
    workspaceKey: string;
    filePath: string;
    deleted: boolean;
  };
};

export type RuntimeWorkspaceSkillFilesCommandPayload = {
  commandId?: string;
  workspaceKey: string;
  spec: string;
};

export type RuntimeWorkspaceSkillFilesResultPayload = {
  commandId: string;
  instanceId: string;
  ok: boolean;
  error?: string;
  data: {
    workspaceKey: string;
    spec: string;
    files: RuntimeWorkspaceFileEntry[];
  };
};
