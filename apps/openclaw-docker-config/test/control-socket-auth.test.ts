import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const {
  appendRecentAuthScreen,
  buildAuthLoginShellCommand,
  defaultModelForAuthProvider,
  isValidAuthProviderId,
  modelCatalogEntryForAuthProvider,
  pluginIdForAuthProvider,
  resolveAuthOrderTarget,
  shellQuoteArg,
  shouldTransitionAuthSessionToWaitingInput,
} = require("../docker/control-socket-auth.js") as {
  appendRecentAuthScreen: (current: string, next: string) => string;
  buildAuthLoginShellCommand: (provider: string) => string;
  defaultModelForAuthProvider: (provider: string) => string | null;
  isValidAuthProviderId: (provider: string) => boolean;
  modelCatalogEntryForAuthProvider: (
    provider: string,
  ) => { id: string; name: string } | null;
  pluginIdForAuthProvider: (provider: string) => string | null;
  resolveAuthOrderTarget: (
    profiles: Array<{ id?: string; type?: string }>,
    kind: "apikey" | "subscription",
  ) => { profileId: string; order: string[] } | null;
  shellQuoteArg: (value: string) => string;
  shouldTransitionAuthSessionToWaitingInput: (input: {
    output: string;
    authInputSubmittedAtMs?: number;
    now?: number;
  }) => boolean;
};

describe("control-socket auth automation", () => {
  it("keeps a recent normalized screen buffer", () => {
    const screen = appendRecentAuthScreen(
      "",
      "\u001b[?25l│\r\n◆  Enable hooks?\r\n│  ◻ Skip for now\r\n│  ◻ 🚀 boot-md\r\n└",
    );

    expect(screen).toContain("Enable hooks?");
    expect(screen).toContain("Skip for now");
    expect(screen).not.toContain("[?25l");
  });

  it("resolves the default model for a linked OAuth subscription provider", () => {
    // "openai" is OpenClaw's canonical provider id for both API-key and
    // ChatGPT/Codex OAuth auth — see docs/concepts/oauth.md. Older
    // "openai-codex" ids are legacy state OpenClaw's own `doctor --fix`
    // repairs; we must not reintroduce it.
    expect(defaultModelForAuthProvider("openai")).toBe("openai/gpt-5.5");
    expect(defaultModelForAuthProvider(" openai ")).toBe("openai/gpt-5.5");
  });

  it("returns null for an unknown or missing auth provider", () => {
    expect(defaultModelForAuthProvider("xiaomi")).toBeNull();
    expect(defaultModelForAuthProvider("")).toBeNull();
    expect(defaultModelForAuthProvider(undefined as unknown as string)).toBeNull();
  });

  it("maps openai's OAuth subscription to the codex runtime plugin", () => {
    // A ChatGPT/Codex OAuth subscription resolves to provider id "openai",
    // but the runtime routes it through the separate "codex" plugin —
    // verified end-to-end: without allowing+enabling this plugin, the
    // linked model resolves via `openclaw models list` but fails at
    // inference with "Unknown model".
    expect(pluginIdForAuthProvider("openai")).toBe("codex");
  });

  it("returns null for a provider with no known runtime plugin", () => {
    expect(pluginIdForAuthProvider("xiaomi")).toBeNull();
    expect(pluginIdForAuthProvider("")).toBeNull();
    expect(pluginIdForAuthProvider(undefined as unknown as string)).toBeNull();
  });

  it("derives the model catalog entry a linked OAuth subscription needs to actually run inference", () => {
    // Confirmed against a live gateway: `openclaw models list` resolves
    // openai/gpt-5.5 via live plugin discovery even with no config entry,
    // but real inference fails with FailoverError: Unknown model until
    // models.providers.openai.models[] contains { id: "gpt-5.5", name:
    // "gpt-5.5" }.
    expect(modelCatalogEntryForAuthProvider("openai")).toEqual({
      id: "gpt-5.5",
      name: "gpt-5.5",
    });
  });

  it("returns null for a provider with no known default model", () => {
    expect(modelCatalogEntryForAuthProvider("xiaomi")).toBeNull();
    expect(modelCatalogEntryForAuthProvider("")).toBeNull();
  });

  it("ignores immediate prompt echo right after redirect submission", () => {
    expect(
      shouldTransitionAuthSessionToWaitingInput({
        output: "◆  Paste the redirect URL",
        authInputSubmittedAtMs: 10_000,
        now: 10_800,
      }),
    ).toBe(false);

    expect(
      shouldTransitionAuthSessionToWaitingInput({
        output: "◆  Paste the redirect URL",
        authInputSubmittedAtMs: 10_000,
        now: 12_000,
      }),
    ).toBe(true);
  });

  describe("resolveAuthOrderTarget", () => {
    // openclaw's `models auth list --provider <id> --json` reports the
    // credential-store `type` ("api_key" / "oauth" / "token"), not the
    // config-side auth.profiles mode string ("api-key") — see #289.
    const profiles = [
      { id: "openai:default", type: "api_key" },
      { id: "openai:ritsuko", type: "oauth" },
    ];

    it("picks the api_key profile first, with the rest appended after it", () => {
      expect(resolveAuthOrderTarget(profiles, "apikey")).toEqual({
        profileId: "openai:default",
        order: ["openai:default", "openai:ritsuko"],
      });
    });

    it("picks the oauth profile first, with the rest appended after it", () => {
      expect(resolveAuthOrderTarget(profiles, "subscription")).toEqual({
        profileId: "openai:ritsuko",
        order: ["openai:ritsuko", "openai:default"],
      });
    });

    it("treats a token-type profile as a subscription credential", () => {
      const tokenProfiles = [
        { id: "anthropic:default", type: "api_key" },
        { id: "anthropic:setup-token", type: "token" },
      ];
      expect(resolveAuthOrderTarget(tokenProfiles, "subscription")).toEqual({
        profileId: "anthropic:setup-token",
        order: ["anthropic:setup-token", "anthropic:default"],
      });
    });

    it("returns null when no profile of the requested kind is saved", () => {
      expect(resolveAuthOrderTarget([{ id: "openai:default", type: "api_key" }], "subscription")).toBeNull();
    });

    it("returns null for an empty or non-array profile list", () => {
      expect(resolveAuthOrderTarget([], "apikey")).toBeNull();
      expect(resolveAuthOrderTarget(undefined as unknown as [], "apikey")).toBeNull();
    });

    it("returns null for an unknown kind", () => {
      expect(
        resolveAuthOrderTarget(profiles, "unknown" as unknown as "apikey"),
      ).toBeNull();
    });

    it("ignores profile entries with no id", () => {
      const withBlank = [{ id: "", type: "api_key" }, { id: "openai:ritsuko", type: "oauth" }];
      expect(resolveAuthOrderTarget(withBlank, "subscription")).toEqual({
        profileId: "openai:ritsuko",
        order: ["openai:ritsuko"],
      });
    });
  });

  describe("isValidAuthProviderId", () => {
    it("accepts lowercase alphanumeric provider ids with dashes and underscores", () => {
      expect(isValidAuthProviderId("openai")).toBe(true);
      expect(isValidAuthProviderId("openai-codex")).toBe(true);
      expect(isValidAuthProviderId("openai_codex_2")).toBe(true);
    });

    it("rejects anything that isn't a strict [a-z0-9_-]+ token", () => {
      expect(isValidAuthProviderId("OpenAI")).toBe(false);
      expect(isValidAuthProviderId("openai; rm -rf /")).toBe(false);
      expect(isValidAuthProviderId("openai'$(whoami)")).toBe(false);
      expect(isValidAuthProviderId("")).toBe(false);
      expect(isValidAuthProviderId(" openai")).toBe(false);
      expect(isValidAuthProviderId(undefined as unknown as string)).toBe(false);
    });
  });

  describe("shellQuoteArg", () => {
    it("wraps a plain value in single quotes", () => {
      expect(shellQuoteArg("openai")).toBe("'openai'");
    });

    it("escapes embedded single quotes so the value can't break out of the quoting", () => {
      expect(shellQuoteArg("a'b")).toBe("'a'\\''b'");
    });

    it("neutralizes shell metacharacters and injection attempts", () => {
      const malicious = "openai'; rm -rf / #";
      const quoted = shellQuoteArg(malicious);
      expect(quoted).toBe("'openai'\\''; rm -rf / #'");
    });
  });

  describe("buildAuthLoginShellCommand", () => {
    it("builds a fully quoted openclaw models auth login command", () => {
      expect(buildAuthLoginShellCommand("openai")).toBe(
        "'openclaw' 'models' 'auth' 'login' '--provider' 'openai' '--force' '--agent' 'main'",
      );
    });

    it("names the owning agent: OpenClaw refuses the login once Templates have added agents", () => {
      // Without --agent, `openclaw models auth login` fails with "Multiple agents
      // are configured, but the model command has no explicit owner".
      expect(buildAuthLoginShellCommand("openai")).toContain("'--agent' 'main'");
    });

    it("quotes an injection attempt in the provider id rather than executing it", () => {
      const command = buildAuthLoginShellCommand("openai'; rm -rf / #");
      // The malicious text stays inert *inside* single quotes; what matters
      // is that the embedded `'` was escaped so it can't close the quoting
      // early and let the rest run as a shell command.
      expect(command).toContain("--provider' 'openai'\\''; rm -rf / #'");
    });
  });
});
