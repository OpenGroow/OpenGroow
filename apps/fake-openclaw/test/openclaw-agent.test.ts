import { describe, it, expect } from "vitest";
import {
  RUNTIME_OPENCLAW_EXEC,
  RUNTIME_OPENCLAW_EXEC_RESULT,
  RUNTIME_WORKSPACE_FILE_READ,
  RUNTIME_WORKSPACE_FILE_READ_RESULT,
  RUNTIME_WORKSPACE_FILE_WRITE,
  RUNTIME_WORKSPACE_FILE_WRITE_RESULT,
  buildRuntimeResultEventId,
  type Command,
} from "@opengroow/protocol";
import { createMissionAwareDispatcher } from "../src/openclaw-agent.js";

const INSTANCE = "fake-instance";

function cmd(type: string, payload?: unknown, id = "cmd-1"): Command {
  return { id, type, payload, ts: Date.now() };
}

describe("createMissionAwareDispatcher", () => {
  it("for an openclaw agent exec, parses the run file path, reads the run file, writes a review RunResult to outputs, and emits ok:true", () => {
    const dispatch = createMissionAwareDispatcher();
    const missionId = "m-1";
    const runId = "r-1";
    const workspaceKey = "ws-seo";
    const runPath = `missions/${missionId}/runs/${runId}.md`;
    const outputsPath = `missions/${missionId}/outputs/${runId}.json`;

    // Pre-stage workspace by sending file writes through the dispatcher itself.
    dispatch(
      cmd(RUNTIME_WORKSPACE_FILE_WRITE, {
        workspaceKey,
        filePath: `missions/${missionId}/context.md`,
        content: "# spec",
      }, "w1"),
      INSTANCE,
    );
    const writeRunEvt = dispatch(
      cmd(RUNTIME_WORKSPACE_FILE_WRITE, {
        workspaceKey,
        filePath: runPath,
        content: "trigger pointer",
      }, "w2"),
      INSTANCE,
    );
    expect(writeRunEvt?.type).toBe(RUNTIME_WORKSPACE_FILE_WRITE_RESULT);

    const message = `Read ${runPath}. Follow the instructions there. On completion, write the RunResult to ${outputsPath}.`;
    const commandText = `openclaw agent --agent seo --session-id mega-mission-${missionId} --message "${message}" --json --timeout 600000`;

    const execEvt = dispatch(
      cmd(
        RUNTIME_OPENCLAW_EXEC,
        { commandText, workspaceKey, runFilePath: runPath, outputsFilePath: outputsPath },
        "exec-1",
      ),
      INSTANCE,
    );
    expect(execEvt?.id).toBe(buildRuntimeResultEventId("exec-1"));
    expect(execEvt?.type).toBe(RUNTIME_OPENCLAW_EXEC_RESULT);
    const execPayload = execEvt?.payload as { ok: boolean };
    expect(execPayload.ok).toBe(true);

    // Subsequent FILE_READ on the outputs path returns the deterministic SEO review RunResult.
    const readEvt = dispatch(
      cmd(RUNTIME_WORKSPACE_FILE_READ, { workspaceKey, filePath: outputsPath }, "r-cmd-1"),
      INSTANCE,
    );
    expect(readEvt?.type).toBe(RUNTIME_WORKSPACE_FILE_READ_RESULT);
    const readPayload = readEvt?.payload as { ok: boolean; data?: { content?: string } };
    expect(readPayload.ok).toBe(true);
    expect(readPayload.data?.content).toBeDefined();
    const parsed = JSON.parse(readPayload.data!.content!);
    expect(parsed.status).toBe("needs_human_review");
    expect(parsed.reviewQuestions).toEqual(["Is the article ready to publish?"]);
    // Post-migration shape: identity in external.id, not metadata.articleId (ADR-020 / #146).
    expect(parsed.artifact.external.id).toBe("article-fake");
    expect(parsed.artifact.external.service).toBe("article-mcp");

    // Article content stays in article-mcp (not written to workspace) — no file read needed.
  });

  it("when the run file referenced by the structured payload is missing, emits ok:false on the exec result", () => {
    const dispatch = createMissionAwareDispatcher();
    const commandText = `openclaw agent --agent seo --session-id mega-mission-m --message "..." --json --timeout 600000`;
    const evt = dispatch(
      cmd(
        RUNTIME_OPENCLAW_EXEC,
        {
          commandText,
          workspaceKey: "ws-seo",
          runFilePath: "missions/m/runs/r.md",
          outputsFilePath: "missions/m/outputs/r.json",
        },
        "exec-2",
      ),
      INSTANCE,
    );
    expect(evt?.type).toBe(RUNTIME_OPENCLAW_EXEC_RESULT);
    const p = evt?.payload as { ok: boolean; error?: string };
    expect(p.ok).toBe(false);
  });

  it("applies workspace files carried by the exec command before reading the run file", () => {
    const dispatch = createMissionAwareDispatcher();
    const workspaceKey = "ws-seo";
    const runFilePath = "missions/m/runs/r.md";
    const outputsFilePath = "missions/m/outputs/r.json";

    const evt = dispatch(
      cmd(
        RUNTIME_OPENCLAW_EXEC,
        {
          commandText: "openclaw agent --agent seo",
          workspaceKey,
          runFilePath,
          outputsFilePath,
          filesToWrite: [
            { filePath: runFilePath, content: "trigger pointer" },
            { filePath: "AGENTS.md", content: "# Mission instructions" },
          ],
        },
        "exec-with-files",
      ),
      INSTANCE,
    );

    expect(evt?.type).toBe(RUNTIME_OPENCLAW_EXEC_RESULT);
    expect(evt?.payload).toMatchObject({ ok: true });

    const readAgents = dispatch(
      cmd(
        RUNTIME_WORKSPACE_FILE_READ,
        { workspaceKey, filePath: "AGENTS.md" },
        "read-agents",
      ),
      INSTANCE,
    );
    expect(readAgents?.payload).toMatchObject({
      ok: true,
      data: { content: "# Mission instructions" },
    });
  });
});
