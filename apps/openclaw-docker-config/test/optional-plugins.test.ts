import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { parseOptionalPlugins, reconcileOptionalPlugins, summarizeFailure } = require("../docker/optional-plugins.js") as {
  parseOptionalPlugins: (raw: string | undefined) => { enabled: string[]; unknown: string[] };
  summarizeFailure: (message: string) => string;
  reconcileOptionalPlugins: (options: {
    requested: string | undefined;
    version: string;
    run: (args: string[]) => Promise<string>;
    log?: (message: string) => void;
  }) => Promise<{ installed: string[]; uninstalled: string[]; failed: string[] }>;
};

describe("parseOptionalPlugins", () => {
  it("returns nothing for an unset or blank variable", () => {
    expect(parseOptionalPlugins(undefined)).toEqual({ enabled: [], unknown: [] });
    expect(parseOptionalPlugins("  ")).toEqual({ enabled: [], unknown: [] });
  });

  it("splits on commas, trims, lowercases and dedupes", () => {
    expect(parseOptionalPlugins(" Codex, whatsapp ,codex")).toEqual({
      enabled: ["codex", "whatsapp"],
      unknown: [],
    });
  });

  it("separates unknown ids", () => {
    expect(parseOptionalPlugins("codex,nope")).toEqual({ enabled: ["codex"], unknown: ["nope"] });
  });
});

type FakePlugin = { id: string; origin: string; enabled: boolean };

// A fake `openclaw` CLI over an in-memory plugin registry and config.
function setup(options: {
  requested: string | undefined;
  plugins?: FakePlugin[];
  allow?: string[] | null;
  failOn?: string;
}) {
  const plugins: FakePlugin[] = [
    { id: "openai", origin: "bundled", enabled: true },
    ...(options.plugins ?? []),
  ];
  let allow: string[] | null = options.allow === undefined ? ["social-engagement-report-sync"] : options.allow;
  const calls: string[][] = [];
  const configCalls: string[] = [];
  const logs: string[] = [];

  const run = async (args: string[]): Promise<string> => {
    const [command, sub] = args;
    if (command === "plugins" && sub === "list") return JSON.stringify({ plugins });
    if (command === "config") configCalls.push(sub);
    if (command === "config" && sub === "get") {
      if (allow === null) throw new Error("Config path not found: plugins.allow");
      return JSON.stringify(allow);
    }
    if (command === "config" && sub === "set") {
      allow = JSON.parse(args[4]) as string[];
      return "";
    }
    calls.push(args);
    if (options.failOn && args.join(" ").includes(options.failOn)) throw new Error("boom");
    const id = args[2];
    if (sub === "install") {
      const installedId = (/@openclaw\/([a-z-]+?)(?:-provider)?@/.exec(args[2])?.[1] ?? id);
      plugins.push({ id: installedId, origin: "global", enabled: false });
    } else if (sub === "enable") {
      const plugin = plugins.find((entry) => entry.id === id);
      if (plugin) plugin.enabled = true;
    } else if (sub === "uninstall") {
      plugins.splice(plugins.findIndex((entry) => entry.id === id), 1);
    }
    return "";
  };

  const reconcile = () =>
    reconcileOptionalPlugins({
      requested: options.requested,
      version: "2026.8.1",
      run,
      log: (message) => logs.push(message),
    });
  return { reconcile, calls, configCalls, logs, allow: () => allow, plugins: () => plugins.map((entry) => entry.id) };
}

describe("reconcileOptionalPlugins", () => {
  it("does nothing when nothing is requested and nothing is installed", async () => {
    const t = setup({ requested: "" });
    expect(await t.reconcile()).toEqual({ installed: [], uninstalled: [], failed: [] });
    expect(t.calls).toEqual([]);
  });

  it("installs a requested plugin pinned to the OpenClaw version, enables and allows it", async () => {
    const t = setup({ requested: "codex" });
    const result = await t.reconcile();
    expect(result.installed).toEqual(["codex"]);
    expect(t.calls).toEqual([
      ["plugins", "install", "npm:@openclaw/codex@2026.8.1", "--accept-capabilities", "--force", "--pin"],
      ["plugins", "enable", "codex"],
    ]);
    expect(t.allow()).toEqual(["social-engagement-report-sync", "codex"]);
  });

  it("installs the provider plugins from their @openclaw/*-provider packages", async () => {
    const t = setup({ requested: "xiaomi,groq" });
    await t.reconcile();
    const installs = t.calls.filter((call) => call[1] === "install").map((call) => call[2]);
    expect(installs).toEqual(["npm:@openclaw/xiaomi-provider@2026.8.1", "npm:@openclaw/groq-provider@2026.8.1"]);
  });

  it("reads and writes plugins.allow once however many plugins change", async () => {
    const t = setup({ requested: "codex,whatsapp,xiaomi,groq" });
    await t.reconcile();
    expect(t.configCalls).toEqual(["get", "set"]);
    expect(t.allow()).toEqual(["social-engagement-report-sync", "codex", "whatsapp", "xiaomi", "groq"]);
  });

  it("does not touch plugins.allow when nothing changes", async () => {
    const t = setup({
      requested: "codex",
      plugins: [{ id: "codex", origin: "global", enabled: true }],
      allow: ["codex"],
    });
    await t.reconcile();
    expect(t.configCalls).toEqual(["get"]);
  });

  it("never creates plugins.allow: an absent list already allows everything", async () => {
    const t = setup({ requested: "codex", allow: null });
    await t.reconcile();
    expect(t.allow()).toBeNull();
  });

  it("skips plugins that are already installed, enabled and allowed", async () => {
    const t = setup({
      requested: "codex",
      plugins: [{ id: "codex", origin: "global", enabled: true }],
      allow: ["codex"],
    });
    expect(await t.reconcile()).toEqual({ installed: [], uninstalled: [], failed: [] });
    expect(t.calls).toEqual([]);
  });

  it("repairs a plugin left installed but disabled and not allowed by an interrupted start", async () => {
    const t = setup({
      requested: "codex",
      plugins: [{ id: "codex", origin: "global", enabled: false }],
    });
    const result = await t.reconcile();
    expect(result.installed).toEqual([]);
    expect(t.calls).toEqual([["plugins", "enable", "codex"]]);
    expect(t.allow()).toContain("codex");
  });

  it("uninstalls an installed optional plugin that is not requested, even one this reconciler never recorded", async () => {
    const t = setup({
      requested: "codex",
      plugins: [
        { id: "codex", origin: "global", enabled: true },
        { id: "whatsapp", origin: "global", enabled: true },
      ],
      allow: ["codex", "whatsapp"],
    });
    const result = await t.reconcile();
    expect(result.uninstalled).toEqual(["whatsapp"]);
    expect(t.calls).toEqual([["plugins", "uninstall", "whatsapp", "--force"]]);
    expect(t.allow()).toEqual(["codex"]);
  });

  it("never empties plugins.allow, which would block every plugin", async () => {
    const t = setup({
      requested: "",
      plugins: [{ id: "whatsapp", origin: "global", enabled: true }],
      allow: ["whatsapp"],
    });
    await t.reconcile();
    expect(t.allow()).toEqual(["whatsapp"]);
  });

  it("leaves unrelated plugins alone", async () => {
    const t = setup({
      requested: "",
      plugins: [{ id: "social-engagement-report-sync", origin: "global", enabled: true }],
    });
    await t.reconcile();
    expect(t.calls).toEqual([]);
  });

  it("reports a failed install and carries on with the others", async () => {
    const t = setup({ requested: "codex,whatsapp", failOn: "codex" });
    const result = await t.reconcile();
    expect(result.failed).toEqual(["codex"]);
    expect(result.installed).toEqual(["whatsapp"]);
  });

  it("reports a failed uninstall", async () => {
    const t = setup({
      requested: "",
      plugins: [{ id: "whatsapp", origin: "global", enabled: true }],
      failOn: "uninstall",
    });
    expect((await t.reconcile()).failed).toEqual(["whatsapp"]);
  });

  it("warns about unknown ids without failing", async () => {
    const t = setup({ requested: "nope" });
    expect(await t.reconcile()).toEqual({ installed: [], uninstalled: [], failed: [] });
    expect(t.logs.some((line) => line.includes("nope"))).toBe(true);
  });
});

describe("summarizeFailure", () => {
  it("drops config warnings and keeps the first lines of the real cause", () => {
    const message = [
      "[config] warnings: plugins.allow: plugin not found: x (stale config entry ignored)",
      "npm view failed: npm error code ECONNREFUSED",
      "npm error syscall connect",
      "npm error errno ECONNREFUSED",
      "npm error FetchError: request to http://127.0.0.1:9/ failed",
      "npm error     at ClientRequest.<anonymous> (...)",
    ].join("\n");
    expect(summarizeFailure(message)).toBe(
      "npm view failed: npm error code ECONNREFUSED | npm error syscall connect | npm error errno ECONNREFUSED",
    );
  });

  it("falls back to the whole message when nothing else is left", () => {
    expect(summarizeFailure("[config] warnings: only this")).toBe("[config] warnings: only this");
  });
});
