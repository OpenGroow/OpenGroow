import * as React from "react";
import type { ParsedWorkspaceFilePayload } from "@/src/components/instance-workspace.types";

export type WorkspaceFileReadOperation =
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

export type WorkspaceFileReadRequest = {
  instanceId: string;
  workspaceKey: string;
  filePath: string;
  resetKey: number;
};

export type WorkspaceFileReadState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "data"; data: ParsedWorkspaceFilePayload }
  | { status: "error"; error: string };

export function useWorkspaceFileRead({
  request,
  read,
}: {
  request: WorkspaceFileReadRequest | null;
  read: (args: {
    instanceId: string;
    workspaceKey: string;
    filePath: string;
  }) => Promise<WorkspaceFileReadOperation>;
}): WorkspaceFileReadState {
  const [state, setState] = React.useState<WorkspaceFileReadState>({
    status: "idle",
  });

  React.useEffect(() => {
    if (!request) {
      setState({ status: "idle" });
      return;
    }

    let cancelled = false;
    setState({ status: "loading" });
    void read({
      instanceId: request.instanceId,
      workspaceKey: request.workspaceKey,
      filePath: request.filePath,
    })
      .then((result) => {
        if (cancelled) return;
        if (!result.found) {
          setState({ status: "error", error: result.error });
          return;
        }
        setState({
          status: "data",
          data: {
            ok: true,
            workspaceKey: result.workspaceKey,
            filePath: result.filePath,
            title: result.title,
            content: result.content,
            lastModifiedAt: result.lastModifiedAt,
          },
        });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setState({
          status: "error",
          error:
            error instanceof Error
              ? error.message
              : "Could not load this file",
        });
      });

    return () => {
      cancelled = true;
    };
  }, [
    read,
    request?.filePath,
    request?.instanceId,
    request?.resetKey,
    request?.workspaceKey,
  ]);

  return state;
}
