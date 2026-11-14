import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const { createChannelWorkflow } = require("../docker/control-socket-channel-workflow.js");

function setup() {
  let time = 0;
  const runCommandCapture = vi.fn().mockResolvedValue({ stdout: "", stderr: "" });
  const readGatewayDefaultModel = vi.fn().mockResolvedValue({
    provider: "openrouter", model: "deepseek/deepseek-chat",
  });
  const workflow = createChannelWorkflow({
    runCommandCapture,
    readGatewayDefaultModel,
    readOpenClawConfigValue: vi.fn(),
    configTimeoutMs: 1_500,
    now: () => time,
    sleep: async (ms: number) => { time += ms; },
    log: vi.fn(),
  });
  return { workflow, runCommandCapture, readGatewayDefaultModel };
}

const input = {
  provider: "openrouter", model: "openrouter/deepseek/deepseek-chat",
  apiKey: "test-key", baseUrl: "https://openrouter.ai/api/v1",
};

describe("AI provider activation", () => {
  it("writes the key, model and provider together before checking the running gateway", async () => {
    const { workflow, runCommandCapture, readGatewayDefaultModel } = setup();
    readGatewayDefaultModel.mockImplementation(async () => {
      expect(runCommandCapture).toHaveBeenCalledTimes(1);
      return { provider: "openrouter", model: "deepseek/deepseek-chat" };
    });
    expect((await workflow.configureAi(input)).body.ok).toBe(true);
    const [command, args] = runCommandCapture.mock.calls[0];
    expect(command).toBe("openclaw");
    expect(args.slice(0, 4)).toEqual(["config", "set", "--merge", "--batch-json"]);
    expect(JSON.parse(args[4])).toEqual([
      { path: "env.vars", value: { OPENROUTER_API_KEY: "test-key" } },
      { path: "agents.defaults.model", value: { primary: input.model } },
      { path: "models.providers.openrouter", value: {
        baseUrl: input.baseUrl, apiKey: "OPENROUTER_API_KEY", api: "openai-completions",
      } },
    ]);
    expect(readGatewayDefaultModel).toHaveBeenCalled();
  });

  it("waits through a stale model and a gateway restart before reporting success", async () => {
    const { workflow, readGatewayDefaultModel } = setup();
    readGatewayDefaultModel
      .mockResolvedValueOnce({ provider: "xiaomi", model: "mimo-v2.5" })
      .mockRejectedValueOnce(new Error("connection closed during restart"));
    expect((await workflow.configureAi(input)).body.ok).toBe(true);
    expect(readGatewayDefaultModel).toHaveBeenCalledTimes(3);
  });

  it("fails instead of reporting saved when the live model never changes", async () => {
    const { workflow, readGatewayDefaultModel } = setup();
    readGatewayDefaultModel.mockResolvedValue({ provider: "xiaomi", model: "mimo-v2.5" });
    await expect(workflow.configureAi(input)).rejects.toThrow("did not activate");
  });

  it("does not accept a matching model name from a different provider", async () => {
    const { workflow, readGatewayDefaultModel } = setup();
    readGatewayDefaultModel.mockResolvedValue({ provider: "other", model: "deepseek/deepseek-chat" });
    await expect(workflow.configureAi(input)).rejects.toThrow("did not activate");
  });

  it("keeps the saved key when activating an existing provider", async () => {
    const { workflow, runCommandCapture } = setup();
    await workflow.configureAi({ ...input, apiKey: "" });
    const operations = JSON.parse(runCommandCapture.mock.calls[0][1][4]);
    expect(operations.some((op: { path: string }) => op.path.startsWith("env."))).toBe(false);
  });

  it("does not check activation after a failed atomic write", async () => {
    const { workflow, runCommandCapture, readGatewayDefaultModel } = setup();
    runCommandCapture.mockRejectedValue(new Error("invalid configuration"));
    await expect(workflow.configureAi(input)).rejects.toThrow("invalid configuration");
    expect(readGatewayDefaultModel).not.toHaveBeenCalled();
  });
});
