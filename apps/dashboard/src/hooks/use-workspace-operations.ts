import * as React from "react";
import type {
  ParsedWorkspaceListPayload,
  ParsedWorkspaceSkillFilesPayload,
} from "@/src/components/instance-workspace.types";
import type {
  RuntimeWorkspaceDescriptor,
  RuntimeWorkspaceFileEntry,
} from "@opengroow/protocol";

export type WorkspaceCommandResult<T> =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "data"; data: T }
  | { status: "error"; error: string };

export type WorkspaceOperationRequest = {
  instanceId: string;
  resetKey: number;
};

export function useWorkspaceOperation<TRequest extends object, TData extends object>({
  request,
  run,
}: {
  request: (TRequest & WorkspaceOperationRequest) | null;
  run: (request: TRequest & { instanceId: string }) => Promise<TData | { error: string }>;
}): WorkspaceCommandResult<TData> {
  const [result, setResult] = React.useState<WorkspaceCommandResult<TData>>({ status: "idle" });
  const requestKey = request ? JSON.stringify(request) : null;

  React.useEffect(() => {
    if (!request || !requestKey) {
      setResult({ status: "idle" });
      return;
    }
    let cancelled = false;
    setResult({ status: "loading" });
    void run(request)
      .then((response) => {
        if (cancelled) return;
        if ("error" in response) setResult({ status: "error", error: response.error });
        else setResult({ status: "data", data: response });
      })
      .catch((error: unknown) => {
        if (!cancelled) setResult({ status: "error", error: error instanceof Error ? error.message : "Workspace operation failed" });
      });
    return () => {
      cancelled = true;
    };
  }, [requestKey, run]);

  return result;
}

export function toWorkspaceListPayload(
  result: { workspaces: Array<{ workspaceKey: string; label: string; absolutePath: string; isActive: boolean; kind: RuntimeWorkspaceDescriptor["kind"]; availableFiles: Array<{ filePath: string; title: string; kind: string }> }> } | { error: string },
): ParsedWorkspaceListPayload | { error: string } {
  if ("error" in result) return result;
  return {
    ok: true,
    workspaces: result.workspaces.map((workspace) => ({
      ...workspace,
      availableFiles: workspace.availableFiles.filter(
        (file): file is RuntimeWorkspaceFileEntry => file.kind === "standard" || file.kind === "memory" || file.kind === "skill",
      ),
    })),
  };
}

export function toWorkspaceSkillFilesPayload(
  result: { workspaceKey: string; spec: string; files: Array<{ filePath: string; title: string; kind: string }> } | { error: string },
): ParsedWorkspaceSkillFilesPayload | { error: string } {
  if ("error" in result) return result;
  return {
    ok: true,
    workspaceKey: result.workspaceKey,
    spec: result.spec,
    files: result.files.filter(
      (file): file is RuntimeWorkspaceFileEntry => file.kind === "standard" || file.kind === "memory" || file.kind === "skill",
    ),
  };
}
