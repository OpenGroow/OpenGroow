import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Licence policy (issue #721, docs/LICENSING.md): the product is AGPL-3.0-only.
const root = path.resolve(__dirname, "..");

// Test data, not shipped packages: Template fixtures are copied/digested by tests.
const EXCLUDED = [/(^|\/)__fixtures__\//, /^fixtures\//, /^hub-template\//];

function productPackageJsons(): string[] {
  const files = execFileSync("git", ["ls-files", "--", "package.json", "**/package.json"], {
    cwd: root,
    encoding: "utf8",
  })
    .split("\n")
    .filter(Boolean);
  return files.filter((file) => !EXCLUDED.some((pattern) => pattern.test(file)));
}

describe("licence policy", () => {
  it("has the AGPL-3.0 text at the repository root", () => {
    const licensePath = path.join(root, "LICENSE");
    expect(existsSync(licensePath)).toBe(true);
    const text = readFileSync(licensePath, "utf8");
    expect(text).toContain("GNU AFFERO GENERAL PUBLIC LICENSE");
    expect(text).toContain("Version 3, 19 November 2007");
  });

  it("declares license AGPL-3.0-only in every product package.json", () => {
    const files = productPackageJsons();
    expect(files.length).toBeGreaterThan(10);
    const wrong = files.filter((file) => {
      const pkg = JSON.parse(readFileSync(path.join(root, file), "utf8")) as { license?: string };
      return pkg.license !== "AGPL-3.0-only";
    });
    expect(wrong).toEqual([]);
  });

  it("keeps the hub template under a permissive licence", () => {
    expect(readFileSync(path.join(root, "hub-template/LICENSE"), "utf8")).toMatch(/^MIT License/);
  });

  it("documents the audit", () => {
    expect(existsSync(path.join(root, "docs/LICENSING.md"))).toBe(true);
  });
});
