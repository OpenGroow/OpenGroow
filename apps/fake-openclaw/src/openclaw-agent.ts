import {
  buildRuntimeResultEventId,
  RUNTIME_OPENCLAW_EXEC,
  RUNTIME_OPENCLAW_EXEC_RESULT,
  RUNTIME_WORKSPACE_FILE_READ,
  RUNTIME_WORKSPACE_FILE_READ_RESULT,
  RUNTIME_WORKSPACE_FILE_WRITE,
  RUNTIME_WORKSPACE_FILE_WRITE_RESULT,
  type Command,
} from "@opengroow/protocol";
import { buildCommandEvent, type RuntimeEvent } from "./ws-dispatch.js";

type Dispatcher = (command: Command, instanceId: string) => RuntimeEvent | null;

export function createMissionAwareDispatcher(): Dispatcher {
  const workspace = new Map<string, string>();
  const key = (workspaceKey: string, filePath: string) => `${workspaceKey}::${filePath}`;

  return (command, instanceId) => {
    if (!command.id) return null;
    const p =
      command.payload && typeof command.payload === "object" && !Array.isArray(command.payload)
        ? (command.payload as Record<string, unknown>)
        : undefined;

    if (command.type === RUNTIME_WORKSPACE_FILE_WRITE) {
      const workspaceKey = typeof p?.workspaceKey === "string" ? p.workspaceKey : "";
      const filePath = typeof p?.filePath === "string" ? p.filePath : "";
      const content = typeof p?.content === "string" ? p.content : null;
      const ok = workspaceKey.length > 0 && filePath.length > 0 && content !== null;
      if (ok) workspace.set(key(workspaceKey, filePath), content!);
      return {
        id: buildRuntimeResultEventId(command.id),
        type: RUNTIME_WORKSPACE_FILE_WRITE_RESULT,
        payload: {
          commandId: command.id,
          instanceId,
          ok,
          error: ok ? undefined : "invalid file write payload",
          data: { workspaceKey, filePath },
        },
        ts: Date.now(),
      };
    }

    if (command.type === RUNTIME_WORKSPACE_FILE_READ) {
      const workspaceKey = typeof p?.workspaceKey === "string" ? p.workspaceKey : "";
      const filePath = typeof p?.filePath === "string" ? p.filePath : "";
      const stored = workspace.get(key(workspaceKey, filePath));
      const found = stored !== undefined;
      return {
        id: buildRuntimeResultEventId(command.id),
        type: RUNTIME_WORKSPACE_FILE_READ_RESULT,
        payload: {
          commandId: command.id,
          instanceId,
          ok: found,
          error: found ? undefined : "file not found",
          data: { workspaceKey, filePath, content: stored, found },
        },
        ts: Date.now(),
      };
    }

    if (command.type === RUNTIME_OPENCLAW_EXEC) {
      const workspaceKey = typeof p?.workspaceKey === "string" ? p.workspaceKey : "";
      // The dispatcher carries mission files on the exec itself so the Runtime
      // Worker writes them, in order, immediately before starting the agent.
      // Mirror that here.
      if (Array.isArray(p?.filesToWrite) && workspaceKey) {
        for (const entry of p.filesToWrite as unknown[]) {
          if (!entry || typeof entry !== "object") continue;
          const { filePath, content } = entry as Record<string, unknown>;
          if (typeof filePath !== "string" || typeof content !== "string") continue;
          workspace.set(key(workspaceKey, filePath), content);
        }
      }
      const runFilePath = typeof p?.runFilePath === "string" ? p.runFilePath : "";
      const outputsFilePath = typeof p?.outputsFilePath === "string" ? p.outputsFilePath : "";
      if (!workspaceKey || !runFilePath || !outputsFilePath) {
        return buildCommandEvent(command, instanceId);
      }
      if (Array.isArray(p?.filesToWrite)) {
        for (const file of p.filesToWrite) {
          if (
            !file ||
            typeof file !== "object" ||
            Array.isArray(file) ||
            typeof (file as Record<string, unknown>).filePath !== "string" ||
            typeof (file as Record<string, unknown>).content !== "string"
          ) {
            return execResult(command.id, instanceId, false, "invalid filesToWrite payload");
          }
          const { filePath, content } = file as { filePath: string; content: string };
          workspace.set(key(workspaceKey, filePath), content);
        }
      }
      if (!workspace.has(key(workspaceKey, runFilePath))) {
        return execResult(command.id, instanceId, false, `run file missing: ${runFilePath}`);
      }
      const articlePath = outputsFilePath.replace(/\/outputs\/[^/]+\.json$/, "/artifacts/article.md");
      const articleContent = [
        "# Article draft",
        "",
        "This is a deterministic fake SEO article generated for mission review.",
        "",
        "It gives the dashboard a real workspace artifact to render before publication.",
      ].join("\n");
      const result = JSON.stringify({
        status: "needs_human_review",
        summary: "Article generated — awaiting human review before publication.",
        reviewQuestions: ["Is the article ready to publish?"],
        artifact: {
          kind: "markdown",
          external: { service: "article-mcp", id: "article-fake" },
          metadata: { keyword: "octopus" },
        },
      });
      workspace.set(key(workspaceKey, articlePath), articleContent);
      workspace.set(key(workspaceKey, outputsFilePath), result);
      return execResult(command.id, instanceId, true);
    }

    return buildCommandEvent(command, instanceId);
  };
}

function execResult(
  commandId: string,
  instanceId: string,
  ok: boolean,
  error?: string,
): RuntimeEvent {
  return {
    id: buildRuntimeResultEventId(commandId),
    type: RUNTIME_OPENCLAW_EXEC_RESULT,
    payload: { commandId, instanceId, ok, error },
    ts: Date.now(),
  };
}
