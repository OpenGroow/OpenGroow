import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
// @ts-expect-error plain .mjs module
import { superviseLocalControl } from "./local-control-supervisor.mjs";

function fakeChild() {
  const child = new EventEmitter() as EventEmitter & { kill: ReturnType<typeof vi.fn> };
  child.kill = vi.fn();
  return child;
}

describe("superviseLocalControl", () => {
  it("reuses an already-listening local-control instead of starting a second one", async () => {
    const spawn = vi.fn();
    const handle = await superviseLocalControl({
      port: 4610,
      isPortOpen: async () => true,
      checkHealth: async () => true,
      spawn,
      log: vi.fn(),
    });
    expect(spawn).not.toHaveBeenCalled();
    expect(handle.reused).toBe(true);
    handle.stop(); // no-op, must not throw
  });

  it("spawns local-control when nothing listens and kills it on stop", async () => {
    const child = fakeChild();
    const spawn = vi.fn(() => child);
    const handle = await superviseLocalControl({ port: 4610, isPortOpen: async () => false, spawn, log: vi.fn() });
    expect(spawn).toHaveBeenCalledOnce();
    expect(handle.reused).toBe(false);
    handle.stop();
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
    handle.stop();
    expect(child.kill).toHaveBeenCalledTimes(1);
  });

  it("does not kill a child that already exited, and reports the unexpected exit", async () => {
    const child = fakeChild();
    const log = vi.fn();
    const handle = await superviseLocalControl({ port: 4610, isPortOpen: async () => false, spawn: () => child, log });
    child.emit("exit", 1, null);
    handle.stop();
    expect(child.kill).not.toHaveBeenCalled();
    expect(log.mock.calls.flat().join(" ")).toMatch(/exited/);
  });

  it("reports a spawn failure (child 'error') visibly instead of crashing on an unhandled event", async () => {
    const child = fakeChild();
    const log = vi.fn();
    const handle = await superviseLocalControl({ port: 4610, isPortOpen: async () => false, spawn: () => child, log });
    expect(() => child.emit("error", new Error("spawn pnpm ENOENT"))).not.toThrow();
    expect(log.mock.calls.flat().join(" ")).toMatch(/failed to start.*ENOENT/);
    handle.stop();
    expect(child.kill).not.toHaveBeenCalled();
  });

  it("verifies a reused local-control and warns loudly when it is not one", async () => {
    const log = vi.fn();
    const handle = await superviseLocalControl({
      port: 4610,
      isPortOpen: async () => true,
      checkHealth: async () => false,
      spawn: vi.fn(),
      log,
    });
    expect(handle.reused).toBe(true);
    expect(log.mock.calls.flat().join(" ")).toMatch(/WARNING.*not an openclaw-local-control/);
  });

  it("tells a healthy reused local-control must share the HMAC secret", async () => {
    const log = vi.fn();
    await superviseLocalControl({
      port: 4610,
      isPortOpen: async () => true,
      checkHealth: async () => true,
      spawn: vi.fn(),
      log,
    });
    expect(log.mock.calls.flat().join(" ")).toMatch(/OPENCLAW_LOCAL_CONTROL_KEYS/);
  });
});
