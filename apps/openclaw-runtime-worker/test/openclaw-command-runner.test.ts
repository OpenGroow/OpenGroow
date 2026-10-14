import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { OpenClawCommandRunner } from "../src/process/openclaw-command-runner";

function createFakeChild() {
  const child = new EventEmitter() as EventEmitter & {
    stdout: PassThrough;
    stderr: PassThrough;
    kill: (signal: NodeJS.Signals) => boolean;
    kills: NodeJS.Signals[];
  };

  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kills = [];
  child.kill = (signal: NodeJS.Signals) => {
    child.kills.push(signal);
    return true;
  };

  return child;
}

describe("OpenClawCommandRunner", () => {
  it("returns stdout and stderr on normal completion", async () => {
    const child = createFakeChild();
    const runner = new OpenClawCommandRunner(
      (() => {
        setTimeout(() => {
          child.stdout.write("hello\n");
          child.stderr.write("warn\n");
          child.emit("close", 0, null);
        }, 0);
        return child as any;
      }) as any,
      10,
    );

    await expect(
      runner.runOpenClawCommand(["devices", "list"], 100),
    ).resolves.toEqual({
      stdout: "hello",
      stderr: "warn",
      exitCode: 0,
      signal: null,
    });
  });

  it("times out with SIGTERM when the process exits during the grace period", async () => {
    vi.useFakeTimers();
    const child = createFakeChild();
    child.kill = (signal: NodeJS.Signals) => {
      child.kills.push(signal);
      if (signal === "SIGTERM") {
        setTimeout(() => {
          child.emit("close", null, "SIGTERM");
        }, 5);
      }
      return true;
    };

    const runner = new OpenClawCommandRunner((() => child as any) as any, 20);
    const promise = runner.runOpenClawCommand(["devices", "list"], 50);
    const expectation = expect(promise).rejects.toThrow(/SIGTERM/);

    await vi.advanceTimersByTimeAsync(60);
    await expectation;
    expect(child.kills).toEqual(["SIGTERM"]);
    vi.useRealTimers();
  });

  it("escalates to SIGKILL when the process ignores SIGTERM", async () => {
    vi.useFakeTimers();
    const child = createFakeChild();
    child.kill = (signal: NodeJS.Signals) => {
      child.kills.push(signal);
      if (signal === "SIGKILL") {
        setTimeout(() => {
          child.emit("close", null, "SIGKILL");
        }, 0);
      }
      return true;
    };

    const runner = new OpenClawCommandRunner((() => child as any) as any, 20);
    const promise = runner.runOpenClawCommand(["devices", "list"], 50);
    const expectation = expect(promise).rejects.toThrow(/SIGKILL/);

    await vi.advanceTimersByTimeAsync(80);
    await expectation;
    expect(child.kills).toEqual(["SIGTERM", "SIGKILL"]);
    vi.useRealTimers();
  });
});
