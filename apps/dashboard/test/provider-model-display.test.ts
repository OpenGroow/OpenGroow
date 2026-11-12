import { describe, expect, it } from "vitest";
import { displayModelForProvider, qualifyModelForProvider } from "../src/components/instance-workspace.utils";

describe("provider model display", () => {
  it("shows the model as typed, without the provider prefix OpenClaw needs", () => {
    expect(displayModelForProvider("openrouter", "openrouter/deepseek/deepseek-v4.1-flash-1017")).toBe(
      "deepseek/deepseek-v4.1-flash-1017",
    );
    expect(displayModelForProvider("openai", "openai/gpt-4o")).toBe("gpt-4o");
  });

  it("keeps a model that is not prefixed with its own provider", () => {
    expect(displayModelForProvider("openrouter", "deepseek/deepseek-v4.1-flash")).toBe("deepseek/deepseek-v4.1-flash");
    expect(displayModelForProvider("openai", "openrouter/x")).toBe("openrouter/x");
  });

  it("round-trips: what the form shows is saved back with its prefix", () => {
    const saved = "openrouter/deepseek/deepseek-v4.1-flash-1017";
    expect(qualifyModelForProvider("openrouter", displayModelForProvider("openrouter", saved))).toBe(saved);
  });
});
