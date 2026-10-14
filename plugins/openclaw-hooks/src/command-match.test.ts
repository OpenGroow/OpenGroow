import { describe, expect, it } from "vitest";
import { isNodeHostExecCall } from "./command-match.js";

describe("isNodeHostExecCall", () => {
  it("accepts an exec call targeting the node host", () => {
    expect(isNodeHostExecCall({ toolName: "exec", params: { host: "node", command: "ls" } })).toBe(true);
  });

  it("rejects an exec call on another host or without one", () => {
    expect(isNodeHostExecCall({ toolName: "exec", params: { host: "default", command: "ls" } })).toBe(false);
    expect(isNodeHostExecCall({ toolName: "exec", params: { command: "ls" } })).toBe(false);
  });

  it("rejects non-exec tools, even when they carry host: node", () => {
    expect(isNodeHostExecCall({ toolName: "write", params: { host: "node", command: "ls" } })).toBe(false);
  });

  // The Codex harness exposes a dedicated `node_exec` tool instead of `exec`
  // with a `host` param: it is always the node bridge.
  it("accepts the Codex node_exec bridge, which carries no host param", () => {
    expect(isNodeHostExecCall({ toolName: "node_exec", params: { command: "ls", workdir: "/x" } })).toBe(true);
  });
});
