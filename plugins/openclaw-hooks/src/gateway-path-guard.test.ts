import { describe, expect, it } from "vitest";
import { GATEWAY_PATH_BLOCK_REASON, handleBeforeToolCall } from "./gateway-path-guard.js";

const gatewayWorkdir = "/home/node/.openclaw/workspace-b3fa29f7";

describe("handleBeforeToolCall", () => {
  it("blocks a node_exec whose workdir is a gateway workspace path", () => {
    const event = { toolName: "node_exec", params: { command: "sed -n 1,20p x.md", workdir: gatewayWorkdir } };

    expect(handleBeforeToolCall(event)).toEqual({ block: true, blockReason: GATEWAY_PATH_BLOCK_REASON });
  });

  it("blocks an exec on host node whose workdir is a gateway workspace path", () => {
    const event = { toolName: "exec", params: { host: "node", command: "ls", workdir: gatewayWorkdir } };

    expect(handleBeforeToolCall(event)).toMatchObject({ block: true });
  });

  it("allows a node exec without a workdir", () => {
    const event = { toolName: "node_exec", params: { command: "opengroow-android observe --json" } };

    expect(handleBeforeToolCall(event)).toBeUndefined();
  });

  it("allows an in-container exec, where the gateway path is valid", () => {
    const event = { toolName: "exec", params: { command: "ls", workdir: gatewayWorkdir } };

    expect(handleBeforeToolCall(event)).toBeUndefined();
  });

  it("allows a node exec with a Mac workdir", () => {
    const event = { toolName: "node_exec", params: { command: "ls", workdir: "/Users/alice/Projects" } };

    expect(handleBeforeToolCall(event)).toBeUndefined();
  });

  it("blocks a node command the agent policy rejects, with the policy's reason", () => {
    const event = { toolName: "node_exec", params: { command: "printenv SECRET" } };
    const policy = (_context: { agentId?: string }, command: unknown) =>
      command === "printenv SECRET" ? "not allowed" : undefined;

    expect(handleBeforeToolCall(event, { agentId: "a" }, policy)).toEqual({ block: true, blockReason: "not allowed" });
  });

  it("lets the agent policy see the agent id and the command", () => {
    const seen: unknown[] = [];
    const policy = (context: { agentId?: string }, command: unknown) => {
      seen.push(context.agentId, command);
      return undefined;
    };

    handleBeforeToolCall({ toolName: "node_exec", params: { command: "ls" } }, { agentId: "a" }, policy);

    expect(seen).toEqual(["a", "ls"]);
  });

  it("does not consult the policy for an in-container exec", () => {
    const policy = () => "never";

    expect(handleBeforeToolCall({ toolName: "exec", params: { command: "ls" } }, {}, policy)).toBeUndefined();
  });
});
