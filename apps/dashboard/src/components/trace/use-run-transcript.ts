"use client";

import * as React from "react";
import { useAction } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { SessionTranscriptTurn } from "@/src/components/workspace-logs.types";

export type RunTranscriptState =
  | { status: "loading" }
  | { status: "error"; error: string }
  | { status: "data"; found: boolean; turns: SessionTranscriptTurn[] };

/**
 * Reads the Run's transcript once. Extension point (#204): polling while the
 * Run is not terminal (one request at a time, final read at the terminal
 * state, last valid Trace kept on a failed poll) is added here, not in the view.
 */
export function useRunTranscript(args: {
  instanceId: string | null | undefined;
  workspaceKey: string;
  runId: Id<"runs">;
  /** False for a Run with no session yet: nothing is requested. */
  enabled: boolean;
}): RunTranscriptState {
  const { instanceId, workspaceKey, runId, enabled } = args;
  const getTranscript = useAction(api.workspace_logs_node.getWorkspaceRunTranscript);
  const [state, setState] = React.useState<RunTranscriptState>({ status: "loading" });

  React.useEffect(() => {
    if (!enabled || !instanceId) return;
    let cancelled = false;
    setState({ status: "loading" });
    getTranscript({ instanceId, workspaceKey, runId })
      .then((result) => {
        if (!cancelled) setState({ status: "data", found: result.found, turns: result.turns });
      })
      .catch((err: unknown) => {
        if (!cancelled) setState({ status: "error", error: err instanceof Error ? err.message : "Failed to load the trace" });
      });
    return () => {
      cancelled = true;
    };
    // getTranscript is intentionally omitted: useAction returns a stable ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, instanceId, workspaceKey, runId]);

  return state;
}
