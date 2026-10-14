import { describe, expect, it, vi, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import os from "node:os";

vi.mock("node:fs/promises", () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  readFile: vi.fn(),
  writeFile: vi.fn().mockResolvedValue(undefined),
  rename: vi.fn(),
}));

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  ensureLocalNodeConfig,
  resolveOpenClawStateDir,
  resolveOpenClawBin,
} from "../src/node-run-openclaw.js";

const mockReadFile = vi.mocked(readFile);
const mockWriteFile = vi.mocked(writeFile);

function writtenConfig(): Record<string, unknown> {
  const call = mockWriteFile.mock.calls[0];
  return JSON.parse(call[1] as string);
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.unstubAllEnvs();
  mockWriteFile.mockResolvedValue(undefined);
  vi.mocked(mkdir).mockResolvedValue(undefined);
});

describe("ensureLocalNodeConfig", () => {
  it("writes security:full and ask:off for a fresh config (no existing file)", async () => {
    mockReadFile.mockRejectedValue(Object.assign(new Error("ENOENT"), { code: "ENOENT" }));

    await ensureLocalNodeConfig("/state");

    const cfg = writtenConfig();
    expect((cfg.tools as any).exec.security).toBe("full");
    expect((cfg.tools as any).exec.ask).toBe("off");
  });

  it("preserves security and ask when already configured by exec-policy set", async () => {
    mockReadFile.mockResolvedValue(
      JSON.stringify({
        tools: { exec: { security: "sandbox", ask: "on" } },
      }) as any,
    );

    await ensureLocalNodeConfig("/state");

    const cfg = writtenConfig();
    expect((cfg.tools as any).exec.security).toBe("sandbox");
    expect((cfg.tools as any).exec.ask).toBe("on");
  });

  it("removes the legacy mode while keeping the other exec fields", async () => {
    mockReadFile.mockResolvedValue(
      JSON.stringify({
        tools: { exec: { mode: "allow", security: "full", ask: "off" } },
      }) as any,
    );

    await ensureLocalNodeConfig("/state");

    const cfg = writtenConfig();
    expect((cfg.tools as any).exec).not.toHaveProperty("mode");
    expect((cfg.tools as any).exec.security).toBe("full");
  });

  it("adds default security/ask when the file exists without an exec field", async () => {
    mockReadFile.mockResolvedValue(
      JSON.stringify({ someOtherField: true }) as any,
    );

    await ensureLocalNodeConfig("/state");

    const cfg = writtenConfig();
    expect((cfg.tools as any).exec.security).toBe("full");
    expect((cfg.tools as any).exec.ask).toBe("off");
  });

  it("keeps the browser and nodeHost config", async () => {
    mockReadFile.mockRejectedValue(new Error("ENOENT"));

    await ensureLocalNodeConfig("/state");

    const cfg = writtenConfig();
    expect((cfg.browser as any).defaultProfile).toBe("chrome");
    expect((cfg.nodeHost as any).browserProxy.enabled).toBe(true);
  });

  it("writes meta.lastTouchedVersion on a fresh config without lastTouchedAt", async () => {
    mockReadFile.mockRejectedValue(Object.assign(new Error("ENOENT"), { code: "ENOENT" }));

    await ensureLocalNodeConfig("/state");

    const cfg = writtenConfig();
    expect(typeof (cfg.meta as any).lastTouchedVersion).toBe("string");
    expect((cfg.meta as any).lastTouchedVersion.length).toBeGreaterThan(0);
    expect((cfg.meta as any).lastTouchedAt).toBeUndefined();
  });

  it("preserves the existing meta.lastTouchedVersion without overwriting it", async () => {
    const existingMeta = { lastTouchedVersion: "2026.1.0" };
    mockReadFile.mockResolvedValue(
      JSON.stringify({ meta: existingMeta }) as any,
    );

    await ensureLocalNodeConfig("/state");

    const cfg = writtenConfig();
    expect((cfg.meta as any).lastTouchedVersion).toBe("2026.1.0");
  });

  it("strips a legacy lastTouchedAt already present in an existing config", async () => {
    const existingMeta = { lastTouchedVersion: "2026.1.0", lastTouchedAt: "2026-01-01T00:00:00.000Z" };
    mockReadFile.mockResolvedValue(
      JSON.stringify({ meta: existingMeta }) as any,
    );

    await ensureLocalNodeConfig("/state");

    const cfg = writtenConfig();
    expect((cfg.meta as any).lastTouchedVersion).toBe("2026.1.0");
    expect((cfg.meta as any).lastTouchedAt).toBeUndefined();
  });

  it("does not write browser.profiles.chrome.color (rejected by the canonical config schema)", async () => {
    mockReadFile.mockRejectedValue(Object.assign(new Error("ENOENT"), { code: "ENOENT" }));

    await ensureLocalNodeConfig("/state");

    const cfg = writtenConfig();
    const chromeProfile = (cfg.browser as any).profiles.chrome;
    expect(chromeProfile.color).toBeUndefined();
    expect(chromeProfile.driver).toBe("openclaw");
  });
});

describe("resolveOpenClawStateDir", () => {
  beforeEach(() => {
    // never let the legacy-directory migration touch the developer's real home
    vi.stubEnv("HOME", mkdtempSync(path.join(os.tmpdir(), "state-dir-home-")));
  });

  it("creates a stable child directory for a per-instance state key", () => {
    vi.stubEnv("OPENCLAW_STATE_DIR", "");

    expect(resolveOpenClawStateDir("local-instance-a")).toBe(
      path.join(
        os.homedir(),
        ".openclaw-opengroow-connect",
        "local-instance-a",
      ),
    );
  });

  it("sanitizes path separators in a state key", () => {
    vi.stubEnv("OPENCLAW_STATE_DIR", "");

    expect(resolveOpenClawStateDir("instance/a with spaces")).toContain(
      "instance_a_with_spaces",
    );
  });

  it("keeps an explicit state directory as the highest-priority override", () => {
    vi.stubEnv("OPENCLAW_STATE_DIR", "/custom/openclaw-state");

    expect(resolveOpenClawStateDir("local-instance-a")).toBe(
      "/custom/openclaw-state",
    );
  });
});

describe("resolveOpenClawBin", () => {
  it("uses the project-local OpenClaw binary by default", () => {
    expect(resolveOpenClawBin()).toBe(
      path.resolve(
        path.dirname(new URL(import.meta.url).pathname),
        "../node_modules/.bin/openclaw",
      ),
    );
  });

  it("keeps an explicit binary override", () => {
    expect(resolveOpenClawBin("/custom/openclaw")).toBe("/custom/openclaw");
  });
});
