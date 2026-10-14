import { describe, it, expect } from "vitest";
import { clawPackageToTemplate, type ClawPackageFiles } from "./claw-package.js";

/** A minimal valid package; `extra` adds files. */
function pkg(extra: ClawPackageFiles = {}): ClawPackageFiles {
  return {
    "package.json": JSON.stringify({ name: "mini", version: "0.0.1", openclaw: { claw: "CLAW.md" } }),
    "CLAW.md": "---\nschemaVersion: 1\nagent:\n  id: mini\n  name: Mini\n  description: A mini agent\n---\n\nPrompt.\n",
    "workspace/AGENTS.md": "# Mini",
    "profiles/opengroow.yml": ["schemaVersion: 1", "category: demo", "mcpServers: []"].join("\n"),
    ...extra,
  };
}

const pluginFiles = (id = "my-plugin", dir = id): ClawPackageFiles => ({
  [`plugins/${dir}/package.json`]: JSON.stringify({ name: id, type: "module", openclaw: { extensions: ["./dist/index.js"] } }),
  [`plugins/${dir}/openclaw.plugin.json`]: JSON.stringify({ id }),
  [`plugins/${dir}/dist/index.js`]: "export default {};\n",
});

const reasonOf = (files: ClawPackageFiles) => {
  const result = clawPackageToTemplate(files);
  if (result.ok) throw new Error("expected the package to be refused");
  return result.reason;
};

describe("OpenClaw plugins shipped in a Claw package (#661)", () => {
  it("a package without plugins has none", () => {
    const result = clawPackageToTemplate(pkg());
    expect(result.ok && result.template.plugins).toBeUndefined();
  });

  it("collects each plugins/<id>/ folder as a plugin, files relative to the folder", () => {
    const result = clawPackageToTemplate(pkg({ ...pluginFiles("alpha"), ...pluginFiles("beta") }));
    if (!result.ok) throw new Error(result.reason);
    expect(result.template.plugins?.map((p) => p.id)).toEqual(["alpha", "beta"]);
    const alpha = result.template.plugins![0]!;
    expect(alpha.files.map((f) => f.path)).toEqual(["dist/index.js", "openclaw.plugin.json", "package.json"]);
    expect(alpha.files.find((f) => f.path === "dist/index.js")?.content).toBe("export default {};\n");
  });

  it("refuses a plugin whose manifest id differs from its folder name", () => {
    expect(reasonOf(pkg(pluginFiles("real-id", "other-dir")))).toMatch(/plugins\/other-dir.*"real-id".*folder/);
  });

  it("refuses a plugin without openclaw.plugin.json", () => {
    const files = pkg(pluginFiles("p"));
    delete files["plugins/p/openclaw.plugin.json"];
    expect(reasonOf(files)).toMatch(/plugins\/p.*openclaw\.plugin\.json is missing/);
  });

  it("refuses a plugin whose package.json declares no openclaw.extensions entry", () => {
    const files = pkg(pluginFiles("p"));
    files["plugins/p/package.json"] = JSON.stringify({ name: "p" });
    expect(reasonOf(files)).toMatch(/plugins\/p.*openclaw\.extensions/);
  });

  it("refuses invalid JSON in a plugin's manifests", () => {
    const files = pkg(pluginFiles("p"));
    files["plugins/p/openclaw.plugin.json"] = "{nope";
    expect(reasonOf(files)).toMatch(/plugins\/p\/openclaw\.plugin\.json is not valid JSON/);
  });

  it("refuses a file directly under plugins/ and unsafe plugin ids or paths", () => {
    expect(reasonOf(pkg({ "plugins/readme.md": "x" }))).toMatch(/plugins\/readme\.md/);
    expect(reasonOf(pkg(pluginFiles("Bad Id")))).toMatch(/plugin id/);
    const files = pkg(pluginFiles("p"));
    files["plugins/p/dist/../../escape.js"] = "x";
    expect(reasonOf(files)).toMatch(/plugins\/p\/dist\/\.\.\/\.\.\/escape\.js/);
  });

  it("refuses a plugin that ships node_modules/, where the Instance links the OpenClaw SDK", () => {
    const files = pkg(pluginFiles("p"));
    files["plugins/p/node_modules/openclaw/index.js"] = "x";
    expect(reasonOf(files)).toMatch(/plugins\/p\/node_modules\/openclaw\/index\.js.*node_modules/);
  });

  it("refuses a plugin over the size limit", () => {
    const files = pkg(pluginFiles("p"));
    files["plugins/p/dist/big.js"] = "x".repeat(600 * 1024);
    expect(reasonOf(files)).toMatch(/plugins\/p.*KiB/);
  });
});
