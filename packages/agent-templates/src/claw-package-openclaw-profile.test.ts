import { describe, it, expect } from "vitest";
import { clawPackageToTemplate, type ClawPackageFiles } from "./claw-package.js";

function pkg(extra: ClawPackageFiles = {}, profile = ["schemaVersion: 1", "category: demo", "mcpServers: []"].join("\n")): ClawPackageFiles {
  return {
    "package.json": JSON.stringify({ name: "mini", version: "0.0.1", openclaw: { claw: "CLAW.md" } }),
    "CLAW.md": "---\nschemaVersion: 1\nagent:\n  id: mini\n  name: Mini\n  description: A mini agent\n---\n\nPrompt.\n",
    "workspace/AGENTS.md": "# Mini",
    "profiles/opengroow.yml": profile,
    ...extra,
  };
}

describe("OpenClaw agent settings of a Claw package (#663)", () => {
  it("maps the native profiles/openclaw.yml tool deny list to the Template's toolDeny", () => {
    const result = clawPackageToTemplate(
      pkg({ "profiles/openclaw.yml": "schemaVersion: 1\nagent:\n  tools:\n    deny:\n      - sessions_spawn\n" }),
    );
    if (!result.ok) throw new Error(result.reason);
    expect(result.template.manifest.openclawProfile).toEqual({ toolDeny: ["sessions_spawn"] });
  });

  it("carries the exec node, which OpenClaw's native profile cannot, in profiles/opengroow.yml", () => {
    const result = clawPackageToTemplate(
      pkg(
        { "profiles/openclaw.yml": "schemaVersion: 1\nagent:\n  tools:\n    deny: [sessions_spawn]\n" },
        "schemaVersion: 1\ncategory: demo\nmcpServers: []\nopenclawProfile:\n  execNode: My Computer\n",
      ),
    );
    if (!result.ok) throw new Error(result.reason);
    expect(result.template.manifest.openclawProfile).toEqual({ toolDeny: ["sessions_spawn"], execNode: "My Computer" });
  });

  it("is optional", () => {
    const result = clawPackageToTemplate(pkg());
    expect(result.ok && result.template.manifest.openclawProfile).toBeFalsy();
  });

  it("refuses a native profile without schemaVersion 1", () => {
    const result = clawPackageToTemplate(pkg({ "profiles/openclaw.yml": "agent:\n  tools:\n    deny: [a]\n" }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("schemaVersion");
  });

  it("refuses native settings OpenGroow does not apply, naming them", () => {
    const result = clawPackageToTemplate(
      pkg({ "profiles/openclaw.yml": "schemaVersion: 1\nagent:\n  sandbox:\n    mode: all\n" }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("agent.sandbox");
  });

  it("refuses the pre-native toolDeny / execNode keys, pointing to the native shape", () => {
    const result = clawPackageToTemplate(pkg({ "profiles/openclaw.yml": "toolDeny:\n  - sessions_spawn\n" }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("toolDeny");
  });

  it("refuses a tool deny list declared in both profiles", () => {
    const result = clawPackageToTemplate(
      pkg(
        { "profiles/openclaw.yml": "schemaVersion: 1\nagent:\n  tools:\n    deny: [a]\n" },
        "schemaVersion: 1\ncategory: demo\nmcpServers: []\nopenclawProfile:\n  toolDeny: [b]\n",
      ),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/toolDeny.*profiles\/openclaw\.yml/);
  });
});
