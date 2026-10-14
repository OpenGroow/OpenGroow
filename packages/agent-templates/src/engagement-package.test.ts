import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { validateManifest } from "./index.js";
import { clawPackageToTemplate } from "./claw-package.js";
import { readPackageFolder } from "./package-folder.js";

/** The package lives in a self-contained folder that can move to its own repository. */
const PACKAGE_DIR = join(import.meta.dirname, "..", "..", "..", "fixtures", "packages", "engagement");

const asRecord = (files: Array<{ path: string; content: string }>) => Object.fromEntries(files.map((f) => [f.path, f.content]));

describe("@opengroow/engagement generic fixture package (#663)", () => {
  const folder = asRecord(readPackageFolder(PACKAGE_DIR));

  it("has the Claw layout with both profiles", () => {
    expect(Object.keys(folder)).toEqual(
      expect.arrayContaining(["package.json", "CLAW.md", "workspace/AGENTS.md", "workspace/engage.md", "profiles/opengroow.yml", "profiles/openclaw.yml"]),
    );
  });

  it("converts to a valid Template", () => {
    const result = clawPackageToTemplate(folder);
    if (!result.ok) throw new Error(result.reason);
    expect(result.template.manifest.id).toBe("@opengroow/engagement");
    expect(validateManifest(result.template.manifest).ok).toBe(true);
  });

  it("is self-contained: no file points outside the package", () => {
    for (const [path, content] of Object.entries(folder)) {
      expect(path, path).not.toMatch(/\.\./);
      if (path.endsWith(".md") || path.endsWith(".yml")) expect(content, path).not.toMatch(/packages\/agent-templates|apps\/convex/);
    }
  });
});
