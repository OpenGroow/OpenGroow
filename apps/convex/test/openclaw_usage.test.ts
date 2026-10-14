import { describe, expect, it } from "vitest";
import { parseOpenClawUsageOutput } from "../openclaw_usage";

describe("parseOpenClawUsageOutput", () => {
  it("parses the real `openclaw status --usage --json` shape", () => {
    const raw = JSON.stringify({
      usage: {
        updatedAt: 1783080438838,
        providers: [
          {
            provider: "anthropic",
            displayName: "Anthropic",
            windows: [{ label: "5h window", usedPercent: 42, resetAt: 1783090000000 }],
            plan: "Max 20x",
          },
          {
            provider: "xiaomi",
            displayName: "Xiaomi",
            windows: [],
          },
        ],
      },
    });

    const result = parseOpenClawUsageOutput(raw);

    expect(result.parsed).toBe(true);
    expect(result.updatedAt).toBe(1783080438838);
    expect(result.providers).toEqual([
      {
        provider: "anthropic",
        displayName: "Anthropic",
        windows: [{ label: "5h window", usedPercent: 42, resetAt: 1783090000000 }],
        plan: "Max 20x",
      },
      { provider: "xiaomi", displayName: "Xiaomi", windows: [] },
    ]);
  });

  it("falls back to the provider id when displayName is missing", () => {
    const raw = JSON.stringify({
      usage: { providers: [{ provider: "openai", windows: [] }] },
    });

    const result = parseOpenClawUsageOutput(raw);

    expect(result.parsed).toBe(true);
    expect(result.providers).toEqual([{ provider: "openai", displayName: "openai", windows: [] }]);
  });

  it("carries a provider-level error through", () => {
    const raw = JSON.stringify({
      usage: {
        providers: [{ provider: "anthropic", displayName: "Anthropic", windows: [], error: "auth expired" }],
      },
    });

    const result = parseOpenClawUsageOutput(raw);

    expect(result.parsed).toBe(true);
    expect(result.providers[0]).toEqual({
      provider: "anthropic",
      displayName: "Anthropic",
      windows: [],
      error: "auth expired",
    });
  });

  it("drops malformed window entries but keeps the provider", () => {
    const raw = JSON.stringify({
      usage: {
        providers: [
          {
            provider: "anthropic",
            windows: [{ label: "5h window", usedPercent: 10 }, { label: "missing percent" }, "not-an-object"],
          },
        ],
      },
    });

    const result = parseOpenClawUsageOutput(raw);

    expect(result.parsed).toBe(true);
    expect(result.providers[0].windows).toEqual([{ label: "5h window", usedPercent: 10, resetAt: undefined }]);
  });

  it("tolerates a trailing non-JSON secrets notice appended to stdout", () => {
    const raw =
      JSON.stringify({ usage: { providers: [{ provider: "xiaomi", displayName: "Xiaomi", windows: [] }] } }) +
      "\n[secrets] gateway.auth.token: gateway token env var is configured.";

    const result = parseOpenClawUsageOutput(raw);

    expect(result.parsed).toBe(true);
    expect(result.providers).toEqual([{ provider: "xiaomi", displayName: "Xiaomi", windows: [] }]);
  });

  it("returns parsed: false for non-JSON output", () => {
    const result = parseOpenClawUsageOutput("openclaw: command not found");

    expect(result.parsed).toBe(false);
    expect(result.providers).toEqual([]);
  });

  it("returns parsed: false for empty output", () => {
    const result = parseOpenClawUsageOutput("");

    expect(result.parsed).toBe(false);
    expect(result.providers).toEqual([]);
  });

  it("returns parsed: false when usage is missing", () => {
    const result = parseOpenClawUsageOutput(JSON.stringify({ status: "ok" }));

    expect(result.parsed).toBe(false);
    expect(result.providers).toEqual([]);
  });

  it("returns parsed: false when usage.providers is missing or not an array", () => {
    const result = parseOpenClawUsageOutput(JSON.stringify({ usage: {} }));

    expect(result.parsed).toBe(false);
    expect(result.providers).toEqual([]);
  });

  it("returns parsed: false when no provider entries have a recognizable provider id", () => {
    const raw = JSON.stringify({ usage: { providers: [{ windows: [] }, "not-an-object", null] } });

    const result = parseOpenClawUsageOutput(raw);

    expect(result.parsed).toBe(false);
    expect(result.providers).toEqual([]);
  });
});
