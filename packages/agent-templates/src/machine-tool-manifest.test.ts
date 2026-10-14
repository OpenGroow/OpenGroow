import { describe, expect, it } from "vitest";
import { validateManifest } from "./index.js";
import { ANDROID_TOOL_FIXTURE } from "./__fixtures__/machine-tool.js";

const BASE = {
  id: "test",
  name: "Test",
  description: "Test template",
  category: "demo",
  mcpServers: [{ name: "svc", transport: "streamable-http", url: "http://localhost/mcp" }],
};

const withInstall = (patch: Record<string, unknown>) => ({
  ...BASE,
  machinePrerequisites: [{ ...ANDROID_TOOL_FIXTURE, install: { ...ANDROID_TOOL_FIXTURE.install, ...patch } }],
});

function reason(manifest: unknown): string {
  const result = validateManifest(manifest);
  if (result.ok) throw new Error("expected the manifest to be refused");
  return result.reason;
}

describe("machinePrerequisites[].install (#726)", () => {
  it("accepts a complete install declaration", () => {
    expect(validateManifest({ ...BASE, machinePrerequisites: [ANDROID_TOOL_FIXTURE] }).ok).toBe(true);
  });

  it("stays optional: a prerequisite with only a link is still valid", () => {
    const { install: _install, ...linkOnly } = ANDROID_TOOL_FIXTURE;
    expect(validateManifest({ ...BASE, machinePrerequisites: [linkOnly] }).ok).toBe(true);
  });

  it("refuses an unknown key anywhere in the declaration", () => {
    expect(reason(withInstall({ bogus: 1 }))).toContain("install.bogus");
    expect(reason(withInstall({ source: { ...ANDROID_TOOL_FIXTURE.install.source, extra: 1 } }))).toContain("install.source.extra");
  });

  it("requires an https source with a lowercase 64-hex sha256", () => {
    expect(reason(withInstall({ source: { url: "http://hub.example/a.tgz", sha256: "a".repeat(64) } }))).toContain("install.source.url");
    expect(reason(withInstall({ source: { url: "https://hub.example/a.tgz", sha256: "abc" } }))).toContain("install.source.sha256");
    expect(reason(withInstall({ source: { url: "https://hub.example/a.tgz", sha256: "A".repeat(64) } }))).toContain("install.source.sha256");
  });

  it("requires a slug id (it names a directory on the user's machine)", () => {
    expect(reason(withInstall({ id: "../etc" }))).toContain("install.id");
    expect(reason(withInstall({ id: "" }))).toContain("install.id");
  });

  it("takes commands as argv arrays, never shell strings", () => {
    expect(reason(withInstall({ bootstrap: [{ label: "x", run: "python -m venv .venv" }] }))).toContain("run");
    expect(reason(withInstall({ bootstrap: [{ label: "x", run: [] }] }))).toContain("run");
    expect(reason(withInstall({ bootstrap: [{ label: "x", run: ["python3", 3] }] }))).toContain("run");
  });

  it("refuses placeholders other than {dir}", () => {
    expect(reason(withInstall({ bootstrap: [{ label: "x", run: ["{dir}/bin/x", "{home}"] }] }))).toContain("{home}");
  });

  it("requires a version check when the prerequisite declares minVersion", () => {
    const { versionCheck: _v, ...noCheck } = ANDROID_TOOL_FIXTURE.install;
    expect(reason({ ...BASE, machinePrerequisites: [{ ...ANDROID_TOOL_FIXTURE, install: noCheck }] })).toContain("versionCheck");
  });

  it("refuses a versionCheck pattern without a capture group", () => {
    expect(reason(withInstall({ versionCheck: { run: ["{dir}/x", "--version"], pattern: "v\\d+" } }))).toContain("capture group");
  });

  it("refuses a source url that is not a .tgz", () => {
    const source = { ...ANDROID_TOOL_FIXTURE.install.source, url: "https://example.com/a.zip" };
    expect(reason(withInstall({ source }))).toContain(".tgz");
  });

  it("refuses an invalid versionCheck pattern", () => {
    expect(reason(withInstall({ versionCheck: { run: ["{dir}/x", "--version"], pattern: "(" } }))).toContain("versionCheck.pattern");
  });
});
