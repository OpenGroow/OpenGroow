import { afterEach, describe, expect, it } from "vitest";
import { isOptionalPluginEnabled } from "../optional_plugins";

const original = process.env.OPENCLAW_OPTIONAL_PLUGINS;
afterEach(() => {
  if (original === undefined) delete process.env.OPENCLAW_OPTIONAL_PLUGINS;
  else process.env.OPENCLAW_OPTIONAL_PLUGINS = original;
});

describe("isOptionalPluginEnabled", () => {
  it("is false for every plugin when the variable is unset", () => {
    delete process.env.OPENCLAW_OPTIONAL_PLUGINS;
    expect(isOptionalPluginEnabled("whatsapp")).toBe(false);
    expect(isOptionalPluginEnabled("codex")).toBe(false);
  });

  it("matches listed ids, ignoring case and spaces", () => {
    process.env.OPENCLAW_OPTIONAL_PLUGINS = " Codex , whatsapp";
    expect(isOptionalPluginEnabled("codex")).toBe(true);
    expect(isOptionalPluginEnabled("whatsapp")).toBe(true);
    expect(isOptionalPluginEnabled("groq")).toBe(false);
  });
});
