import { mkdtemp, mkdir, readFile, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { afterEach, describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const { createWorkspaceWorkflow } = require("../docker/control-socket-workspace-workflow.js") as {
  createWorkspaceWorkflow: (options?: Record<string, unknown>) => any;
};
const { createMcpWorkflow } = require("../docker/control-socket-mcp-workflow.js") as {
  createMcpWorkflow: (options?: Record<string, unknown>) => any;
};
const { createOpenClawWorkflow } = require("../docker/control-socket-openclaw-workflow.js") as {
  createOpenClawWorkflow: (options?: Record<string, unknown>) => any;
};

const tempDirs: string[] = [];

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function makeHome(prefix: string) {
  const home = await mkdtemp(path.join(tmpdir(), prefix));
  tempDirs.push(home);
  return home;
}

describe("workspace workflow", () => {
  it("keeps traversal validation behind the workflow interface", async () => {
    const homeDir = await makeHome("opengroow-workflow-");
    const workflow = createWorkspaceWorkflow({ homeDir });
    const created = await workflow.create({ workspaceKey: "agent-a" });
    expect(created.status).toBe(200);

    const written = await workflow.write({
      workspaceKey: "agent-a",
      filePath: "AGENTS.md",
      content: "# Agent",
    });
    expect(written.status).toBe(200);
    const read = await workflow.read({ workspaceKey: "agent-a", filePath: "AGENTS.md" });
    expect(read.body.data.content).toBe("# Agent");

    const traversal = await workflow.read({ workspaceKey: "agent-a", filePath: "../openclaw.json" });
    expect(traversal.status).toBe(404);
  });

  it("returns 404 for a file that does not exist in an existing workspace", async () => {
    const homeDir = await makeHome("opengroow-workflow-");
    const workflow = createWorkspaceWorkflow({ homeDir });
    await workflow.create({ workspaceKey: "agent-a" });

    const missing = await workflow.read({ workspaceKey: "agent-a", filePath: "NOTES.md" });
    expect(missing.status).toBe(404);
  });

  it("rejects a malformed read payload without touching the filesystem", async () => {
    const homeDir = await makeHome("opengroow-workflow-");
    const workflow = createWorkspaceWorkflow({ homeDir });
    await workflow.create({ workspaceKey: "agent-a" });

    const missingFilePath = await workflow.read({ workspaceKey: "agent-a" });
    expect(missingFilePath.status).toBe(404);
    expect(missingFilePath.body.ok).toBe(false);

    const missingWorkspaceKey = await workflow.read({ filePath: "AGENTS.md" });
    expect(missingWorkspaceKey.status).toBe(400);
    expect(missingWorkspaceKey.body.ok).toBe(false);
  });
});

describe("MCP workflow", () => {
  it("merges and removes MCP servers through the filesystem adapter", async () => {
    const homeDir = await makeHome("opengroow-mcp-workflow-");
    const workflow = createMcpWorkflow({ homeDir });
    const merged = await workflow.merge({ servers: { search: { command: "node", args: ["search.js"] } } });
    expect(merged.body.data.mergedKeys).toEqual(["search"]);
    const removed = await workflow.remove({ keys: ["search"] });
    expect(removed.body.data.removedKeys).toEqual(["search"]);
    expect(await readFile(path.join(homeDir, ".openclaw", "openclaw.json"), "utf8")).toContain('"servers": {}');
  });
});

describe("OpenClaw command workflow", () => {
  it("does not append the Gateway token to agent commands", async () => {
    vi.stubEnv("OPENCLAW_GATEWAY_TOKEN", "gateway-admin-token");
    const runCommandDetailed = vi.fn(async () => ({
      stdout: "ok",
      stderr: "",
      exitCode: 0,
      signal: null,
    }));
    const workflow = createOpenClawWorkflow({ runCommandDetailed });

    await workflow.execute({
      commandText: "openclaw agent --agent seo --message probe --json --timeout 900",
    });

    expect(runCommandDetailed).toHaveBeenCalledWith(
      "openclaw",
      ["agent", "--agent", "seo", "--message", "probe", "--json", "--timeout", "900"],
      30_000,
      expect.any(Object),
    );
  });

  it("keeps tokenization, allowlists and result mapping behind the workflow", async () => {
    const runCommandDetailed = vi.fn(async (_command: string, args: string[]) => {
      if (args[0] === "status") {
        return { stdout: "clean stdout", stderr: "stderr noise", exitCode: 0, signal: null };
      }
      return { stdout: "partial", stderr: "command failed", exitCode: 1, signal: null };
    });
    const workflow = createOpenClawWorkflow({ runCommandDetailed, sleep: vi.fn().mockResolvedValue(undefined) });

    const success = await workflow.execute({ commandText: "openclaw status" });
    expect(success.body.data.output).toBe("clean stdout");
    expect(runCommandDetailed).toHaveBeenCalledWith("openclaw", ["status"], 30_000, expect.any(Object));

    const failure = await workflow.execute({ commandText: "config get missing" });
    expect(failure.body.data.success).toBe(false);
    expect(failure.body.data.output).toBe("partial\ncommand failed");
    await expect(workflow.execute({ commandText: "openclaw shell -c whoami" })).rejects.toThrow(/Unsupported OpenClaw command root/);
  });

  it("schedules the restart semantic operation without exposing process details to the route", async () => {
    const schedule = vi.fn();
    const workflow = createOpenClawWorkflow({ scheduleGatewayContainerRestart: schedule });
    const result = await workflow.execute({ commandText: "openclaw gateway restart" });
    expect(result.body.data.success).toBe(true);
    // The restart is deferred until the HTTP response has actually been
    // written (see handleWorkflowRoute's `res.on("finish", ...)`), so the
    // workflow itself must not invoke it eagerly.
    expect(schedule).not.toHaveBeenCalled();
    expect(result.afterResponse).toBe(schedule);
  });

  it("cancels a session by pkill-ing its --session-id", async () => {
    const runCommandDetailed = vi.fn(async () => ({
      stdout: "",
      stderr: "",
      exitCode: 0,
      signal: null,
    }));
    const workflow = createOpenClawWorkflow({ runCommandDetailed });

    const result = await workflow.cancel({ sessionId: "s1" });

    expect(runCommandDetailed).toHaveBeenCalledWith("pkill", ["-f", "--", "--session-id s1"], 3000);
    expect(result.status).toBe(200);
    expect(result.body.data.cancelled).toBe(true);
  });

  it("treats a pkill miss (no matching process) as a non-error cancel outcome", async () => {
    // pkill exits 1 when nothing matched — it resolves, it does not throw.
    const runCommandDetailed = vi.fn(async () => ({
      stdout: "",
      stderr: "",
      exitCode: 1,
      signal: null,
    }));
    const workflow = createOpenClawWorkflow({ runCommandDetailed });

    const result = await workflow.cancel({ sessionId: "s1" });

    // Nothing to kill is success, not an error — but `cancelled` reports
    // truthfully that no process was killed.
    expect(result.status).toBe(200);
    expect(result.body.ok).toBe(true);
    expect(result.body.data.cancelled).toBe(false);
  });

  it("reports ok: false when the pkill attempt itself never completes (spawn error / timeout)", async () => {
    // Unlike exit codes 0/1, a spawn failure or timeout means we don't
    // actually know whether the agent process is still alive — cancelMission
    // must not mark the Run/Mission cancelled on this, so Stop stays
    // retryable instead of falsely confirming a kill that may not have
    // happened.
    const runCommandDetailed = vi.fn(async () => {
      throw new Error("pkill timed out after 3000ms");
    });
    const workflow = createOpenClawWorkflow({ runCommandDetailed });

    const result = await workflow.cancel({ sessionId: "s1" });

    expect(result.status).toBe(200);
    expect(result.body.ok).toBe(false);
  });

  it("reports ok: false on a fatal pkill exit code (syntax/fatal error)", async () => {
    // pkill exit code 2 (syntax error) or 3 (fatal error, e.g. permission)
    // is neither "killed" (0) nor "no match" (1) — treat it the same as a
    // spawn failure, not as a confirmed cancel.
    const runCommandDetailed = vi.fn(async () => ({
      stdout: "",
      stderr: "pkill: invalid option",
      exitCode: 2,
      signal: null,
    }));
    const workflow = createOpenClawWorkflow({ runCommandDetailed });

    const result = await workflow.cancel({ sessionId: "s1" });

    expect(result.status).toBe(200);
    expect(result.body.ok).toBe(false);
  });

  it("rejects a cancel request without a sessionId", async () => {
    const runCommandDetailed = vi.fn();
    const workflow = createOpenClawWorkflow({ runCommandDetailed });

    const result = await workflow.cancel({});

    expect(result.status).toBe(400);
    expect(result.body.ok).toBe(false);
    expect(runCommandDetailed).not.toHaveBeenCalled();
  });
});

describe("OpenClaw fallback result on missing outputs file", () => {
  const MISSION_ID = "m123";
  const RUN_ID = "r456";
  const AGENT_CMD = `openclaw agent --agent social --session-id s1 --message "Read missions/${MISSION_ID}/runs/${RUN_ID}.md. Follow the instructions there. On completion, write the RunResult to missions/${MISSION_ID}/outputs/${RUN_ID}.json." --json --timeout 900`;

  async function setupCwd() {
    const cwd = await makeHome("opengroow-fallback-");
    await mkdir(path.join(cwd, "missions", MISSION_ID, "outputs"), { recursive: true });
    return cwd;
  }

  it("writes a fallback result when exec succeeds but the outputs file is missing", async () => {
    const cwd = await setupCwd();
    const runCommandDetailed = vi.fn(async () => ({
      stdout: "[agent] run s1 ended with stopReason=stop",
      stderr: "",
      exitCode: 0,
      signal: null,
    }));
    const workflow = createOpenClawWorkflow({
      runCommandDetailed,
      sleep: vi.fn().mockResolvedValue(undefined),
      cwd,
    });

    const result = await workflow.execute({ commandText: AGENT_CMD });
    expect(result.body.data.success).toBe(true);

    const outputsPath = path.join(cwd, "missions", MISSION_ID, "outputs", `${RUN_ID}.json`);
    const content = JSON.parse(await readFile(outputsPath, "utf-8"));
    expect(content.status).toBe("failed");
    expect(content.error.code).toBe("file_missing");
    expect(content.summary).toContain("did not write its result file");
  });

  it("does not overwrite an existing outputs file when exec succeeds", async () => {
    const cwd = await setupCwd();
    const outputsPath = path.join(cwd, "missions", MISSION_ID, "outputs", `${RUN_ID}.json`);
    const agentResult = JSON.stringify({ status: "success", summary: "all good" });
    const { writeFile } = await import("node:fs/promises");
    await writeFile(outputsPath, agentResult, "utf-8");

    const runCommandDetailed = vi.fn(async () => ({
      stdout: "[agent] run s1 ended with stopReason=stop",
      stderr: "",
      exitCode: 0,
      signal: null,
    }));
    const workflow = createOpenClawWorkflow({
      runCommandDetailed,
      sleep: vi.fn().mockResolvedValue(undefined),
      cwd,
    });

    await workflow.execute({ commandText: AGENT_CMD });

    const content = JSON.parse(await readFile(outputsPath, "utf-8"));
    expect(content.status).toBe("success");
    expect(content.summary).toBe("all good");
  });

  it("writes a fallback result when exec times out", async () => {
    const cwd = await setupCwd();
    const runCommandDetailed = vi.fn(async () => {
      throw new Error("openclaw agent timed out after 900000ms");
    });
    const workflow = createOpenClawWorkflow({
      runCommandDetailed,
      sleep: vi.fn().mockResolvedValue(undefined),
      cwd,
    });

    await expect(workflow.execute({ commandText: AGENT_CMD })).rejects.toThrow(/timed out/);

    const outputsPath = path.join(cwd, "missions", MISSION_ID, "outputs", `${RUN_ID}.json`);
    const content = JSON.parse(await readFile(outputsPath, "utf-8"));
    expect(content.status).toBe("failed");
    expect(content.error.code).toBe("timeout");
    expect(content.summary).toContain("timed out");
  });

  it("does not write a fallback for non-agent commands", async () => {
    const cwd = await setupCwd();
    const runCommandDetailed = vi.fn(async () => ({
      stdout: "ok",
      stderr: "",
      exitCode: 0,
      signal: null,
    }));
    const workflow = createOpenClawWorkflow({
      runCommandDetailed,
      sleep: vi.fn().mockResolvedValue(undefined),
      cwd,
    });

    await workflow.execute({ commandText: "openclaw status" });

    const outputsPath = path.join(cwd, "missions", MISSION_ID, "outputs", `${RUN_ID}.json`);
    await expect(access(outputsPath)).rejects.toThrow();
  });
});
