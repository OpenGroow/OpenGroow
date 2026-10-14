import { describe, expect, it, vi } from "vitest";
import {
  RUNTIME_AGENT_REGISTER_AND_CONFIGURE,
  RUNTIME_AGENT_REGISTER_AND_CONFIGURE_RESULT,
  RUNTIME_OPENCLAW_EXEC,
  RUNTIME_OPENCLAW_EXEC_RESULT,
  RUNTIME_SKILLS_INSTALL_BATCH,
  RUNTIME_SKILLS_INSTALL_BATCH_RESULT,
  type Command,
} from "@opengroow/protocol";
import {
  handleAgentRegisterAndConfigure,
  handleSkillsInstallBatch,
} from "../src/commands/compound-commands.js";
import { handleOpenClawExec } from "../src/commands/config-commands.js";

type ControlCall = { path: string; body: Record<string, unknown> };

function makeDeps(respond: (call: ControlCall) => unknown) {
  const calls: ControlCall[] = [];
  return {
    calls,
    deps: {
      gatewayClient: {
        requestGatewayControl: vi.fn(async (path: string, body: Record<string, unknown>) => {
          const call = { path, body };
          calls.push(call);
          return respond(call);
        }),
      },
      getRuntimeInstanceId: () => "instance-1",
      log: vi.fn(),
      warn: vi.fn(),
    } as any,
  };
}

function makeCommand(type: string, payload: Record<string, unknown>): Command {
  return { id: "cmd-1", type, ts: Date.now(), payload };
}

describe("handleSkillsInstallBatch", () => {
  it("runs the installs strictly one after another (ClawHub is not parallel-safe)", async () => {
    const inFlight: string[] = [];
    let maxConcurrent = 0;
    const { deps, calls } = makeDeps((call) => {
      inFlight.push(String(call.body.commandText));
      maxConcurrent = Math.max(maxConcurrent, inFlight.length);
      inFlight.pop();
      return { output: "installed", success: true };
    });

    const event = await handleSkillsInstallBatch(
      makeCommand(RUNTIME_SKILLS_INSTALL_BATCH, {
        specs: ["owner/one", "owner/two"],
        commandTexts: ["clawhub install owner/one", "clawhub install owner/two"],
      }),
      deps,
    );

    expect(maxConcurrent).toBe(1);
    expect(calls.map((call) => call.body.commandText)).toEqual([
      "clawhub install owner/one",
      "clawhub install owner/two",
    ]);
    expect(event.event.type).toBe(RUNTIME_SKILLS_INSTALL_BATCH_RESULT);
    expect(event.event.payload).toMatchObject({ ok: true });
  });

  it("keeps installing after a failure and reports the per-spec outcome", async () => {
    const { deps } = makeDeps((call) =>
      String(call.body.commandText).includes("owner/one")
        ? { output: "", success: false, error: "skill not found on ClawHub" }
        : { output: "installed", success: true },
    );

    const event = await handleSkillsInstallBatch(
      makeCommand(RUNTIME_SKILLS_INSTALL_BATCH, {
        specs: ["owner/one", "owner/two"],
        commandTexts: ["clawhub install owner/one", "clawhub install owner/two"],
      }),
      deps,
    );

    const payload = event.event.payload as {
      ok: boolean;
      data: { results: Array<{ spec: string; ok: boolean; error?: string }> };
    };
    expect(payload.ok).toBe(false);
    expect(payload.data.results).toEqual([
      { spec: "owner/one", ok: false, output: "", error: "skill not found on ClawHub" },
      { spec: "owner/two", ok: true, output: "installed", error: undefined },
    ]);
  });

  it("rejects a payload whose specs and commandTexts do not line up", async () => {
    const { deps, calls } = makeDeps(() => ({ output: "", success: true }));

    const event = await handleSkillsInstallBatch(
      makeCommand(RUNTIME_SKILLS_INSTALL_BATCH, {
        specs: ["owner/one", "owner/two"],
        commandTexts: ["clawhub install owner/one"],
      }),
      deps,
    );

    expect(calls).toHaveLength(0);
    expect(event.event.payload).toMatchObject({ ok: false });
  });
});

describe("handleAgentRegisterAndConfigure", () => {
  const LIST = "openclaw agents list --json";
  const ADD = "openclaw agents add social-engagement";
  const CONFIGURE = "openclaw config set agents.entries.social-engagement.tools.deny";

  function registerCommand(extra: Record<string, unknown> = {}) {
    return makeCommand(RUNTIME_AGENT_REGISTER_AND_CONFIGURE, {
      agentId: "engagement",
      listCommandText: LIST,
      registerCommandText: ADD,
      configureCommandText: CONFIGURE,
      ...extra,
    });
  }

  function respond(agents: unknown[], overrides: (text: string) => unknown = () => undefined) {
    return (call: ControlCall) => {
      const text = String(call.body.commandText);
      const override = overrides(text);
      if (override !== undefined) return override;
      if (text === LIST) return { output: JSON.stringify(agents), success: true };
      return { output: "ok", success: true };
    };
  }

  it("lists, adds, then configures — in that order, as one command", async () => {
    const { deps, calls } = makeDeps(respond([]));

    const event = await handleAgentRegisterAndConfigure(registerCommand(), deps);

    expect(calls.map((call) => call.body.commandText)).toEqual([LIST, ADD, CONFIGURE]);
    expect(event.event.type).toBe(RUNTIME_AGENT_REGISTER_AND_CONFIGURE_RESULT);
    expect(event.event.payload).toMatchObject({
      ok: true,
      data: { alreadyRegistered: false, registered: true, configured: true },
    });
  });

  it("does not add an agent the list already reports, and returns its workspace", async () => {
    const { deps, calls } = makeDeps(
      respond([{ id: "engagement", workspace: "/workspace/social" }]),
    );

    const event = await handleAgentRegisterAndConfigure(registerCommand(), deps);

    // The existence check lives inside the command: two concurrent
    // activations can no longer both observe the agent as absent.
    expect(calls.map((call) => call.body.commandText)).toEqual([LIST]);
    expect(event.event.payload).toMatchObject({
      ok: true,
      data: { alreadyRegistered: true, registered: true, workspace: "/workspace/social" },
    });
  });

  it("reports a list output that is not a top-level array", async () => {
    const { deps, calls } = makeDeps(() => ({ output: JSON.stringify({ agents: [] }), success: true }));

    const event = await handleAgentRegisterAndConfigure(registerCommand(), deps);

    expect(calls).toHaveLength(1);
    expect(event.event.payload).toMatchObject({ ok: false, data: { registered: false } });
    expect((event.event.payload as { error: string }).error).toContain("invalid JSON");
  });

  it("skips the deny-list write when the registration fails", async () => {
    const { deps, calls } = makeDeps(
      respond([], (text) => (text === ADD ? { output: "", success: false, error: "agents add failed" } : undefined)),
    );

    const event = await handleAgentRegisterAndConfigure(registerCommand(), deps);

    expect(calls.map((call) => call.body.commandText)).toEqual([LIST, ADD]);
    expect(event.event.payload).toMatchObject({
      ok: false,
      error: "agents add failed",
      data: { registered: false, configured: false },
    });
  });

  it("keeps the agent registered but surfaces a failed deny-list write", async () => {
    const { deps } = makeDeps(
      respond([], (text) => (text === CONFIGURE ? { output: "", success: false, error: "config set failed" } : undefined)),
    );

    const event = await handleAgentRegisterAndConfigure(registerCommand(), deps);

    expect(event.event.payload).toMatchObject({
      ok: true,
      data: { registered: true, configured: false, configureError: "config set failed" },
    });
  });
});

describe("handleOpenClawExec filesToWrite", () => {
  it("writes the carried files, in order, before starting the agent", async () => {
    const { deps, calls } = makeDeps(() => ({ output: "done", success: true, exitCode: 0 }));

    await handleOpenClawExec(
      makeCommand(RUNTIME_OPENCLAW_EXEC, {
        commandText: "openclaw agent run",
        workspaceKey: "ws-1",
        filesToWrite: [
          { filePath: "missions/m1/context.md", content: "context" },
          { filePath: "AGENTS.md", content: "instructions" },
        ],
      }),
      deps,
    );

    expect(calls.map((call) => call.path)).toEqual([
      "/workspace/file/write",
      "/workspace/file/write",
      "/openclaw/exec",
    ]);
    expect(calls[0].body).toMatchObject({ workspaceKey: "ws-1", filePath: "missions/m1/context.md" });
    expect(calls[1].body).toMatchObject({ workspaceKey: "ws-1", filePath: "AGENTS.md" });
  });

  it("aborts the exec when a pre-exec write fails", async () => {
    const { deps, calls } = makeDeps((call) => {
      if (call.path === "/workspace/file/write") throw new Error("disk full");
      return { output: "done", success: true };
    });

    const event = await handleOpenClawExec(
      makeCommand(RUNTIME_OPENCLAW_EXEC, {
        commandText: "openclaw agent run",
        workspaceKey: "ws-1",
        filesToWrite: [{ filePath: "AGENTS.md", content: "instructions" }],
      }),
      deps,
    );

    expect(calls.map((call) => call.path)).toEqual(["/workspace/file/write"]);
    expect(event.event.type).toBe(RUNTIME_OPENCLAW_EXEC_RESULT);
    expect(event.event.payload).toMatchObject({
      ok: false,
      error: "Failed to write AGENTS.md before exec: disk full",
    });
  });

  it("refuses to exec when files are carried without a workspaceKey", async () => {
    const { deps, calls } = makeDeps(() => ({ output: "done", success: true }));

    const event = await handleOpenClawExec(
      makeCommand(RUNTIME_OPENCLAW_EXEC, {
        commandText: "openclaw agent run",
        filesToWrite: [{ filePath: "AGENTS.md", content: "instructions" }],
      }),
      deps,
    );

    expect(calls).toHaveLength(0);
    expect(event.event.payload).toMatchObject({ ok: false });
  });
});
