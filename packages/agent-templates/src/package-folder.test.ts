import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readPackageFolder } from "./package-folder";

function folder(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "claw-folder-"));
  for (const [path, content] of Object.entries(files)) {
    const full = join(root, path);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, content);
  }
  return root;
}

describe("readPackageFolder", () => {
  it("returns every file of the package with forward-slash relative paths", () => {
    const root = folder({ "package.json": "{}", "CLAW.md": "# c", "workspace/AGENTS.md": "# a" });
    const files = readPackageFolder(root);
    expect(files.map((f) => f.path).sort()).toEqual(["CLAW.md", "package.json", "workspace/AGENTS.md"]);
    expect(files.find((f) => f.path === "workspace/AGENTS.md")?.content).toBe("# a");
  });

  it("skips VCS metadata, dependencies and OS noise", () => {
    const root = folder({
      "package.json": "{}",
      ".git/HEAD": "ref",
      "node_modules/x/index.js": "x",
      ".DS_Store": "junk",
    });
    expect(readPackageFolder(root).map((f) => f.path)).toEqual(["package.json"]);
  });

  it("fails when the folder does not exist", () => {
    expect(() => readPackageFolder(join(tmpdir(), "does-not-exist-claw"))).toThrow(/not a folder/);
  });

  it("rejects a symlink instead of reading a file outside the package", () => {
    const outside = folder({ "secret.txt": "secret" });
    const root = folder({ "package.json": "{}" });
    symlinkSync(join(outside, "secret.txt"), join(root, "link.txt"));
    expect(() => readPackageFolder(root)).toThrow(/symlink/i);
  });
});
