import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const { createAuthWorkflow } = require("../docker/control-socket-auth-workflow.js") as {
  createAuthWorkflow: (options?: Record<string, unknown>) => {
    start(body?: Record<string, unknown>): Promise<any>;
    status(body?: Record<string, unknown>): Promise<any>;
    input(body?: Record<string, unknown>): Promise<any>;
    cancel(body?: Record<string, unknown>): Promise<any>;
    load(): Promise<void>;
  };
};

class FakeChild extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  stdin = {
    writes: [] as string[],
    write: (value: string) => {
      this.stdin.writes.push(value);
      return true;
    },
  };
  kill = vi.fn();
}

function makeWorkflow(overrides: Record<string, unknown> = {}) {
  let currentTime = 10_000;
  const timers: Array<{ delay: number; callback: () => void; cleared: boolean }> = [];
  const child = new FakeChild();
  const fs = {
    mkdir: vi.fn().mockResolvedValue(undefined),
    writeFile: vi.fn().mockResolvedValue(undefined),
    rename: vi.fn().mockResolvedValue(undefined),
    readFile: vi.fn(),
    unlink: vi.fn().mockResolvedValue(undefined),
  };
  const runCommandCapture = vi.fn(async (_command: string, args: string[]) => {
    if (args.includes("plugins.allow") && args.includes("get")) {
      throw new Error("plugins.allow is not configured");
    }
    if (args.includes("models.providers.openai.models") && args.includes("get")) {
      throw new Error("model catalog is not configured");
    }
    if (args.includes("models") && args.includes("auth") && args.includes("list")) {
      return {
        stdout: JSON.stringify({ profiles: [{ id: "openai:default", type: "oauth" }] }),
        stderr: "",
      };
    }
    return { stdout: "", stderr: "" };
  });
  const workflow = createAuthWorkflow({
    authSessionsPath: "/tmp/auth-sessions.json",
    fs,
    now: () => currentTime,
    setTimer: (callback: () => void, delay: number) => {
      const timer = { delay, callback, cleared: false };
      timers.push(timer);
      return timer;
    },
    clearTimer: (timer: { cleared: boolean }) => {
      timer.cleared = true;
    },
    spawnProcess: () => child,
    runCommandCapture,
    ...overrides,
  });
  return {
    child,
    fs,
    runCommandCapture,
    timers,
    workflow,
    advance(ms: number) {
      currentTime += ms;
    },
  };
}

describe("createAuthWorkflow", () => {
  it("transitions start -> waiting input -> input -> succeeded through the workflow boundary", async () => {
    const { child, workflow } = makeWorkflow();
    const started = await workflow.start({ provider: "openai" });
    expect(started.body.data.status).toBe("running");

    child.stdout.emit("data", "OAuth URL ready: https://auth.example.test/start\n");
    const waiting = await workflow.status({ sessionId: started.body.data.sessionId });
    expect(waiting.body.data.status).toBe("waiting_input");
    expect(waiting.body.data.authUrl).toBe("https://auth.example.test/start");

    const submitted = await workflow.input({
      sessionId: started.body.data.sessionId,
      input: "http://localhost:1455/callback?code=abc",
    });
    expect(submitted.body.ok).toBe(true);
    expect(child.stdin.writes).toEqual(["http://localhost:1455/callback?code=abc\r\n"]);

    child.stdout.emit("data", "Authorization complete\n");
    child.emit("close", 0, null);
    await new Promise((resolve) => setImmediate(resolve));

    const succeeded = await workflow.status({ sessionId: started.body.data.sessionId });
    expect(succeeded.body.data.status).toBe("succeeded");
    expect(succeeded.body.data.model).toBe("openai/gpt-5.5");
  });

  it("fails the session when the prompt timer expires", async () => {
    const { child, timers, workflow } = makeWorkflow();
    const started = await workflow.start({ provider: "openai" });
    timers.find((timer) => timer.delay === 90_000)?.callback();

    const result = await workflow.status({ sessionId: started.body.data.sessionId });
    expect(result.body.data.status).toBe("failed");
    expect(result.body.data.error).toMatch(/URL generation timed out/);
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
  });

  it("fails the session when redirect verification times out", async () => {
    const { child, timers, workflow } = makeWorkflow();
    const started = await workflow.start({ provider: "openai" });
    await workflow.input({
      sessionId: started.body.data.sessionId,
      input: "http://localhost:1455/callback?code=abc",
    });
    timers.find((timer) => timer.delay === 180_000)?.callback();

    const result = await workflow.status({ sessionId: started.body.data.sessionId });
    expect(result.body.data.status).toBe("failed");
    expect(result.body.data.error).toMatch(/verification timed out/);
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
  });

  it("cancels an active session and handles process errors as terminal failures", async () => {
    const first = makeWorkflow();
    const started = await first.workflow.start({ provider: "openai" });
    const cancelled = await first.workflow.cancel({ sessionId: started.body.data.sessionId });
    expect(cancelled.body.data.status).toBe("cancelled");
    expect(first.child.kill).toHaveBeenCalledWith("SIGTERM");

    const second = makeWorkflow();
    const errored = await second.workflow.start({ provider: "openai" });
    second.child.emit("error", new Error("runner unavailable"));
    const result = await second.workflow.status({ sessionId: errored.body.data.sessionId });
    expect(result.body.data.status).toBe("failed");
    expect(result.body.data.error).toBe("runner unavailable");
  });

  it("rejects unknown sessions and redirect values at the workflow boundary", async () => {
    const { workflow } = makeWorkflow();
    expect((await workflow.status({ sessionId: "missing" })).status).toBe(404);

    const started = await workflow.start({ provider: "openai" });
    const result = await workflow.input({
      sessionId: started.body.data.sessionId,
      input: "https://evil.example.test/callback",
    });
    expect(result.status).toBe(400);
    expect(result.body.error).toMatch(/http:\/\/localhost:1455\//);
  });

  it("hydrates an in-flight session as an explicit restart-recovery failure", async () => {
    const fixture = {
      sessions: [
        {
          sessionId: "recovered-session",
          provider: "openai",
          status: "waiting_input",
          logs: ["OAuth URL ready: https://auth.example.test/start"],
          createdAtMs: 1,
          updatedAtMs: 2,
        },
      ],
    };
    const { fs, workflow } = makeWorkflow();
    fs.readFile.mockResolvedValue(JSON.stringify(fixture));
    await workflow.load();

    const result = await workflow.status({ sessionId: "recovered-session" });
    expect(result.body.data.status).toBe("failed");
    expect(result.body.data.awaitingResume).toBe(true);
    expect(result.body.data.error).toMatch(/Gateway restarted/);
  });

  describe("activate", () => {
    it("reactivates a provider that already has a linked credential", async () => {
      const { workflow } = makeWorkflow();
      const result = await (workflow as any).activate({ provider: "openai" });
      expect(result.status).toBe(200);
      expect(result.body.data).toEqual({ provider: "openai", model: "openai/gpt-5.5" });
    });

    const CONFLICT = "The config file changed while this command was writing (config changed since last load), so nothing was changed.";

    function conflictingRunner(conflicts: number) {
      let remaining = conflicts;
      return vi.fn(async (_command: string, args: string[]) => {
        if (args.includes("auth") && args.includes("list")) {
          return { stdout: JSON.stringify({ profiles: [{ id: "openai:default", type: "oauth" }] }), stderr: "" };
        }
        if (args.includes("set") && args.includes("agents.defaults.model") && remaining-- > 0) {
          throw new Error(CONFLICT);
        }
        return { stdout: "", stderr: "" };
      });
    }

    it("retries when the Gateway rewrote the config under the write", async () => {
      const sleep = vi.fn().mockResolvedValue(undefined);
      const { workflow } = makeWorkflow({ runCommandCapture: conflictingRunner(2), sleep });
      const result = await (workflow as any).activate({ provider: "openai" });
      expect(result.status).toBe(200);
      expect(sleep).toHaveBeenCalledTimes(2);
    });

    it("recognises the conflict from the CLI's wrapper sentence alone", async () => {
      const sleep = vi.fn().mockResolvedValue(undefined);
      let first = true;
      const runCommandCapture = vi.fn(async (_command: string, args: string[]) => {
        if (args.includes("auth") && args.includes("list")) {
          return { stdout: JSON.stringify({ profiles: [{ id: "openai:default", type: "oauth" }] }), stderr: "" };
        }
        if (args.includes("set") && first) {
          first = false;
          throw new Error("The config file changed while this command was writing (new wording), so nothing was changed.");
        }
        return { stdout: "", stderr: "" };
      });
      const { workflow } = makeWorkflow({ runCommandCapture, sleep });
      const result = await (workflow as any).activate({ provider: "openai" });
      expect(result.status).toBe(200);
      expect(sleep).toHaveBeenCalledTimes(1);
    });

    it("gives up after repeated conflicts and surfaces the error", async () => {
      const sleep = vi.fn().mockResolvedValue(undefined);
      const { workflow } = makeWorkflow({ runCommandCapture: conflictingRunner(99), sleep });
      const result = await (workflow as any).activate({ provider: "openai" });
      expect(result.status).toBe(500);
      expect(result.body.error).toContain("config changed since last load");
    });

    it("does not retry other failures", async () => {
      const sleep = vi.fn().mockResolvedValue(undefined);
      const runCommandCapture = vi.fn(async (_command: string, args: string[]) => {
        if (args.includes("auth") && args.includes("list")) {
          return { stdout: JSON.stringify({ profiles: [{ id: "openai:default", type: "oauth" }] }), stderr: "" };
        }
        throw new Error("boom");
      });
      const { workflow } = makeWorkflow({ runCommandCapture, sleep });
      const result = await (workflow as any).activate({ provider: "openai" });
      expect(result.status).toBe(500);
      expect(sleep).not.toHaveBeenCalled();
    });

    it("rejects activation for a provider with no default model and no explicit model", async () => {
      const { workflow } = makeWorkflow();
      const result = await (workflow as any).activate({ provider: "unknown-provider" });
      expect(result.status).toBe(400);
      expect(result.body.error).toMatch(/No default model known/);
    });

    it("rejects activation when the provider has no saved credential", async () => {
      const { workflow } = makeWorkflow({
        runCommandCapture: vi.fn().mockResolvedValue({
          stdout: JSON.stringify({ profiles: [] }),
          stderr: "",
        }),
      });
      const result = await (workflow as any).activate({ provider: "openai" });
      expect(result.status).toBe(400);
      expect(result.body.error).toMatch(/No linked credential found/);
    });

    it("surfaces a failure to read saved credentials as a 500", async () => {
      const { workflow } = makeWorkflow({
        runCommandCapture: vi.fn().mockRejectedValue(new Error("gateway unreachable")),
      });
      const result = await (workflow as any).activate({ provider: "openai" });
      expect(result.status).toBe(500);
      expect(result.body.error).toContain("gateway unreachable");
    });
  });

  describe("orderActivate", () => {
    it("switches a provider to its API-key credential and reorders auth.order", async () => {
      const runCommandCapture = vi.fn(async (_command: string, args: string[]) => {
        if (args.includes("list")) {
          return {
            stdout: JSON.stringify({
              profiles: [
                { id: "openai:oauth", type: "oauth" },
                { id: "openai:apikey", type: "api_key" },
              ],
            }),
            stderr: "",
          };
        }
        return { stdout: "", stderr: "" };
      });
      const { workflow } = makeWorkflow({ runCommandCapture });

      const result = await (workflow as any).orderActivate({
        provider: "openai",
        kind: "apikey",
        model: "openai/gpt-5.5",
      });
      expect(result.status).toBe(200);
      expect(result.body.data).toEqual({
        provider: "openai",
        kind: "apikey",
        model: "openai/gpt-5.5",
        profileId: "openai:apikey",
      });
      expect(runCommandCapture).toHaveBeenCalledWith(
        "openclaw",
        ["models", "auth", "order", "set", "--provider", "openai", "openai:apikey", "openai:oauth"],
        expect.any(Number),
      );
    });

    it("rejects an invalid kind before touching the runner", async () => {
      const runCommandCapture = vi.fn();
      const { workflow } = makeWorkflow({ runCommandCapture });
      const result = await (workflow as any).orderActivate({
        provider: "openai",
        kind: "not-a-kind",
        model: "openai/gpt-5.5",
      });
      expect(result.status).toBe(400);
      expect(runCommandCapture).not.toHaveBeenCalled();
    });

    it("rejects switching to a kind with no matching saved credential", async () => {
      const { workflow } = makeWorkflow();
      const result = await (workflow as any).orderActivate({
        provider: "openai",
        kind: "apikey",
        model: "openai/gpt-5.5",
      });
      expect(result.status).toBe(400);
      expect(result.body.error).toMatch(/No saved API-key credential found/);
    });
  });
});
