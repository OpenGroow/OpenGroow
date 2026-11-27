import { describe, expect, it } from "vitest";
import { clawPackageToTemplate, isTemplateVersionRunnable, profileSchemaVersionOf } from "./index.js";
import { validatePackage } from "./validate-package.js";
import { readClawPackageFixture, withFile, type PackageFile } from "./__fixtures__/claw-package.js";

const PROFILE = "profiles/opengroow.yml";
const asRecord = (files: PackageFile[]) => Object.fromEntries(files.map((f) => [f.path, f.content]));
const read = (files: PackageFile[], path: string) => files.find((f) => f.path === path)!.content;
const without = (files: PackageFile[], path: string) => files.filter((f) => f.path !== path);
const editProfile = (files: PackageFile[], edit: (yaml: string) => string) =>
  withFile(files, PROFILE, edit(read(files, PROFILE)));

const studio = () => readClawPackageFixture("studio");
const reasonOf = (files: PackageFile[]) => {
  const result = clawPackageToTemplate(asRecord(files));
  if (result.ok) throw new Error("expected the package to be refused");
  return result.reason;
};

describe("Template contract v2: kind and Bundled Recipes", () => {
  it("accepts a v2 package with a kind on every Mission type and valid Bundled Recipes", () => {
    const result = clawPackageToTemplate(asRecord(studio()));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.template.manifest.missionTypes?.map((m) => [m.type, m.kind])).toEqual([
      ["write_post", "creative"],
      ["moderate", "operational"],
    ]);
    expect(validatePackage(studio())).toEqual({ ok: true, id: "@acme/studio", version: "1.0.0" });
  });

  it("exposes the recipe files with the Template, the Default flagged", () => {
    const result = clawPackageToTemplate(asRecord(studio()));
    if (!result.ok) throw new Error(result.reason);
    expect(result.template.recipes).toEqual([
      {
        missionType: "write_post",
        id: "freeform",
        default: true,
        name: "Freeform",
        description: "Neutral recipe that follows the Mission Brief.",
        instructions: "Write the post the Mission Brief asks for, without imposing a style.",
        constraints: [],
      },
      {
        missionType: "write_post",
        id: "punchy",
        default: false,
        name: "Punchy",
        description: "Short sentences and a strong opening line.",
        prompt: "Open with the most surprising fact.",
        instructions: "Keep sentences under fifteen words and end with a question.",
        constraints: ["No more than 120 words", "No emoji"],
      },
    ]);
  });

  it("accepts a Template without Mission types", () => {
    const files = editProfile(studio(), () => "schemaVersion: 2\ncategory: marketing\nmcpServers: []\n");
    const result = clawPackageToTemplate(asRecord(files));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.template.recipes ?? []).toEqual([]);
  });

  it("refuses a Mission type without kind", () => {
    const files = editProfile(studio(), (y) => y.replace("    kind: operational\n", ""));
    expect(reasonOf(files)).toContain('missionTypes["moderate"]');
    expect(reasonOf(files)).toContain("kind");
    expect(reasonOf(files)).toContain("creative");
  });

  it("refuses a kind that is neither creative nor operational", () => {
    const files = editProfile(studio(), (y) => y.replace("kind: operational", "kind: hybrid"));
    expect(reasonOf(files)).toContain('"hybrid"');
  });

  it("refuses a creative Mission type with no Bundled Recipe", () => {
    const files = editProfile(studio(), (y) => y.replace(/    recipes:\n(      .*\n)+/, ""));
    expect(reasonOf(files)).toContain('missionTypes["write_post"]');
    expect(reasonOf(files)).toContain("recipes");
  });

  it("refuses recipes with no default", () => {
    const files = editProfile(studio(), (y) => y.replace("        default: true\n", ""));
    expect(reasonOf(files)).toContain("exactly one");
    expect(reasonOf(files)).toContain("default");
  });

  it("refuses recipes with two defaults", () => {
    const files = editProfile(studio(), (y) => y.replace("punchy.yml\n", "punchy.yml\n        default: true\n"));
    expect(reasonOf(files)).toContain("exactly one");
  });

  it("refuses duplicate recipe ids", () => {
    const files = editProfile(studio(), (y) => y.replace("id: punchy", "id: freeform"));
    expect(reasonOf(files)).toContain('duplicate recipe id "freeform"');
  });

  it("refuses a missing recipe file, naming it", () => {
    const files = without(studio(), "recipes/write_post/punchy.yml");
    expect(reasonOf(files)).toContain("recipes/write_post/punchy.yml");
    expect(reasonOf(files)).toContain('"punchy"');
  });

  it.each([
    ["a path outside the recipes folder", "recipes/write_post/punchy.yml", "workspace/punchy.yml"],
    ["a parent segment", "recipes/write_post/punchy.yml", "recipes/../workspace/AGENTS.md"],
    ["an absolute path", "recipes/write_post/punchy.yml", "/recipes/punchy.yml"],
    ["a backslash", "recipes/write_post/punchy.yml", "recipes\\\\punchy.yml"],
    ["another extension", "recipes/write_post/punchy.yml", "recipes/write_post/punchy.md"],
  ])("refuses an unsafe recipe path: %s", (_label, from, to) => {
    const files = editProfile(studio(), (y) => y.replace(from, to));
    expect(reasonOf(files)).toContain("recipes");
    expect(reasonOf(files)).toContain('"punchy"');
  });

  it("refuses a recipes declaration on an operational Mission type", () => {
    const files = editProfile(studio(), (y) =>
      y.replace("    payload: '{}'\n", "    payload: '{}'\n    recipes:\n      - id: x\n        path: recipes/write_post/freeform.yml\n        default: true\n"),
    );
    expect(reasonOf(files)).toContain('missionTypes["moderate"]');
    expect(reasonOf(files)).toContain("operational");
  });

  it("refuses an unknown key in a recipe declaration", () => {
    const files = editProfile(studio(), (y) => y.replace("        default: true\n", "        default: true\n        label: Free\n"));
    expect(reasonOf(files)).toContain("label");
  });

  it("refuses a recipe file without instructions, or with an unknown key", () => {
    const noInstructions = withFile(studio(), "recipes/write_post/punchy.yml", "name: Punchy\ndescription: d\nconstraints: []\n");
    expect(reasonOf(noInstructions)).toContain("recipes/write_post/punchy.yml");
    expect(reasonOf(noInstructions)).toContain("instructions");
    const extra = withFile(
      studio(),
      "recipes/write_post/punchy.yml",
      "name: P\ndescription: d\ninstructions: i\nconstraints: []\nmood: loud\n",
    );
    expect(reasonOf(extra)).toContain("mood");
  });
});

describe("Template contract: stored versions", () => {
  it("still reads a v1 package from its stored manifest, without kind or recipes", () => {
    const result = clawPackageToTemplate(asRecord(readClawPackageFixture("legacy")));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.template.manifest.missionTypes?.map((m) => m.type)).toEqual(["write_post", "moderate"]);
    expect(result.template.recipes).toBeUndefined();
    expect(result.template.missionAgentsMd?.write_post).toContain("Write the post");
  });

  it("derives outdated from the stored manifest: below 2, or no schemaVersion at all, is not runnable", () => {
    const v1 = clawPackageToTemplate(asRecord(readClawPackageFixture("legacy")));
    const v2 = clawPackageToTemplate(asRecord(studio()));
    if (!v1.ok || !v2.ok) throw new Error("fixtures must be readable");
    expect(profileSchemaVersionOf(v1.template.manifest)).toBe(1);
    expect(isTemplateVersionRunnable(v1.template.manifest)).toBe(false);
    expect(profileSchemaVersionOf(v2.template.manifest)).toBe(2);
    expect(isTemplateVersionRunnable(v2.template.manifest)).toBe(true);
    // A manifest stored before schemaVersion was recorded on it.
    const { schemaVersion: _recorded, ...stored } = v1.template.manifest;
    expect(profileSchemaVersionOf(stored)).toBe(1);
    expect(isTemplateVersionRunnable(stored)).toBe(false);
  });

  it("refuses to publish a v1 package: the validator is for the current contract", () => {
    const result = validatePackage(readClawPackageFixture("legacy"));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join("\n")).toContain("schemaVersion 2");
  });

  it("refuses a v1 package that declares kind or recipes", () => {
    const files = editProfile(readClawPackageFixture("legacy"), (y) => y.replace("  - type: moderate\n", "  - type: moderate\n    kind: operational\n"));
    expect(reasonOf(files)).toContain("schemaVersion 2");
  });

  it("refuses a schemaVersion it does not know, as an older deployment refuses 2", () => {
    const files = editProfile(studio(), (y) => y.replace("schemaVersion: 2", "schemaVersion: 3"));
    expect(reasonOf(files)).toContain("unsupported schemaVersion 3");
    expect(reasonOf(files)).toContain("1 and 2");
  });
});
