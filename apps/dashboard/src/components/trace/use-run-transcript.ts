"use client";

import * as React from "react";
import { useAction } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { isTerminalRunStatus } from "@/src/lib/trace/normalize-trace";
import type { SessionTranscriptTurn } from "@/src/components/workspace-logs.types";

export type RunTranscriptState =
  | { status: "loading" }
  | { status: "error"; error: string }
  /** `pollError` is set when the latest refresh failed; `turns` is the last valid read. */
  | { status: "data"; found: boolean; turns: SessionTranscriptTurn[]; pollError?: string };

export const TRANSCRIPT_POLL_INTERVAL_MS = 3000;

/**
 * Reads the Run's transcript, and keeps reading about every 3 s while the Run
 * is not terminal: strictly one request in flight, one final read once the Run
 * is terminal, last valid Trace kept when a refresh fails. Stops on unmount.
 */
export function useRunTranscript(args: {
  instanceId: string | null | undefined;
  workspaceKey: string;
  runId: Id<"runs">;
  /** False for a Run with no session yet: nothing is requested. */
  enabled: boolean;
  /** Current Run status; undefined is treated as active. */
  runStatus?: string;
}): RunTranscriptState {
  const { instanceId, workspaceKey, runId, enabled, runStatus } = args;
  const getTranscript = useAction(api.workspace_logs_node.getWorkspaceRunTranscript);
  const [state, setState] = React.useState<RunTranscriptState>({ status: "loading" });
  const terminalRef = React.useRef(false);
  const wakeRef = React.useRef<(() => void) | undefined>(undefined);
  terminalRef.current = runStatus !== undefined && isTerminalRunStatus(runStatus);
  const terminal = terminalRef.current;
  React.useEffect(() => {
    if (terminal) wakeRef.current?.();
  }, [terminal]);

  React.useEffect(() => {
    if (!enabled || !instanceId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let wake: (() => void) | undefined;
    setState({ status: "loading" });

    const read = async () => {
      try {
        const result = await getTranscript({ instanceId, workspaceKey, runId });
        if (!cancelled) setState({ status: "data", found: result.found, turns: result.turns });
      } catch (err: unknown) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : "Failed to load the trace";
        setState((prev) => (prev.status === "data" ? { ...prev, pollError: message } : { status: "error", error: message }));
      }
    };
    const wait = () =>
      new Promise<void>((resolve) => {
        wake = resolve;
        timer = setTimeout(resolve, TRANSCRIPT_POLL_INTERVAL_MS);
      });
    // A status change ends the wait early so the final read is prompt.
    wakeRef.current = () => {
      if (timer) clearTimeout(timer);
      wake?.();
    };

    void (async () => {
      while (!cancelled) {
        const wasTerminal = terminalRef.current;
        await read();
        // A read started while terminal is the final one.
        if (cancelled || wasTerminal) return;
        if (!terminalRef.current) await wait();
      }
    })();

    return () => {
      cancelled = true;
      wakeRef.current = undefined;
      if (timer) clearTimeout(timer);
    };
    // getTranscript is intentionally omitted: useAction returns a stable ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, instanceId, workspaceKey, runId]);

  return state;
}
