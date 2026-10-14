import { describe, expect, it, vi } from "vitest";
import { runOnNode, shellQuote, type NodesRuntime } from "./node-run.js";

function makeNodes(invokeResult: unknown, paired = [{ nodeId: "node_1", displayName: "My Computer" }]): NodesRuntime {
  return {
    list: vi.fn().mockResolvedValue({ nodes: paired }),
    invoke: vi.fn().mockResolvedValue(invokeResult),
  };
}

const okPayload = { payload: { success: true, exitCode: 0, stdout: '{"posts":[]}', stderr: "" } };

describe("runOnNode", () => {
  it("sends system.run an argv array, not a shell string", async () => {
    const nodes = makeNodes(okPayload);

    await runOnNode(nodes, "My Computer", "cat 'report.json'");

    expect(nodes.invoke).toHaveBeenCalledWith({
      nodeId: "node_1",
      command: "system.run",
      params: { command: ["/bin/sh", "-lc", "cat 'report.json'"] },
    });
  });

  it("returns the stdout carried inside the node.invoke payload envelope", async () => {
    const result = await runOnNode(makeNodes(okPayload), "My Computer", "cat x");

    expect(result).toEqual({ stdout: '{"posts":[]}', exitCode: 0 });
  });

  it("reads a payloadJSON envelope too", async () => {
    const nodes = makeNodes({ ok: true, payloadJSON: JSON.stringify({ exitCode: 0, stdout: "hi" }) });

    await expect(runOnNode(nodes, "My Computer", "cat x")).resolves.toEqual({ stdout: "hi", exitCode: 0 });
  });

  it("throws when the node reports a failed invoke", async () => {
    const nodes = makeNodes({ ok: false, error: { code: "NOT_CONNECTED" } });

    await expect(runOnNode(nodes, "My Computer", "cat x")).rejects.toThrow(/node invoke failed/);
  });

  it("throws on a non-zero exit instead of returning empty stdout", async () => {
    const nodes = makeNodes({ payload: { exitCode: 1, stdout: "", stderr: "No such file" } });

    await expect(runOnNode(nodes, "My Computer", "cat x")).rejects.toThrow(/No such file/);
  });

  it("resolves the only paired node when the command carried no node name", async () => {
    const nodes = makeNodes(okPayload);

    await runOnNode(nodes, "", "cat x");

    expect(nodes.invoke).toHaveBeenCalledWith(expect.objectContaining({ nodeId: "node_1" }));
  });

  it("throws when no paired node matches the requested name", async () => {
    const nodes = makeNodes(okPayload);

    await expect(runOnNode(nodes, "Other Mac", "cat x")).rejects.toThrow(/no paired node matches/);
  });
});

describe("shellQuote", () => {
  it("neutralises shell metacharacters a mission/run id could smuggle in", () => {
    expect(shellQuote("missions/$(whoami)/report.json")).toBe("'missions/$(whoami)/report.json'");
    expect(shellQuote("it's")).toBe(`'it'\\''s'`);
  });
});
