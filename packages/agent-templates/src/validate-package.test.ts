import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_PACKAGE_FIXTURES_DIR } from "./__fixtures__/templates.js";
import { readPackageFolder } from "./package-folder.js";
import { validatePackage, validatePackageFolder } from "./validate-package.js";

// The `hello` fixture package of the repository, at the given version.
const filesOf = (version = "1.2.3") =>
  readPackageFolder(join(REPO_PACKAGE_FIXTURES_DIR, "hello")).map((file) =>
    file.path === "package.json"
      ? { ...file, content: file.content.replace(/"version": "[^"]*"/, `"version": "${version}"`) }
      : file,
  );

describe("validatePackage", () => {
  it("accepts a valid package and reports its identity", () => {
    expect(validatePackage(filesOf())).toEqual({ ok: true, id: "@opengroow/hello", version: "1.2.3" });
  });

  it("accepts a release tag <name>@<version> matching the package", () => {
    expect(validatePackage(filesOf(), { tag: "hello@1.2.3" }).ok).toBe(true);
  });

  it.each([
    ["another name", "other@1.2.3"],
    ["another version", "hello@1.2.4"],
    ["no version", "hello"],
  ])("refuses a release tag with %s", (_label, tag) => {
    const result = validatePackage(filesOf(), { tag });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join("\n")).toMatch(/tag/i);
  });

  it("refuses a package that is not a valid Template, with the reason", () => {
    const result = validatePackage(filesOf().filter((f) => f.path !== "CLAW.md"));
    expect(result).toEqual({ ok: false, errors: [expect.stringMatching(/CLAW\.md/)] });
  });

  it("refuses a version that is not semver", () => {
    const files = filesOf().map((f) =>
      f.path === "package.json" ? { ...f, content: f.content.replace(/"version": "[^"]*"/, '"version": "latest"') } : f,
    );
    const result = validatePackage(files);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join("\n")).toMatch(/version/);
  });

  it("refuses duplicate paths", () => {
    const files = filesOf();
    expect(validatePackage([...files, files[0]!]).ok).toBe(false);
  });
});

describe("validatePackageFolder", () => {
  it("reads and validates a folder", () => {
    const root = mkdtempSync(join(tmpdir(), "pkg-"));
    for (const { path, content } of filesOf()) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), content);
    }
    expect(validatePackageFolder(root, { tag: "hello@1.2.3" }).ok).toBe(true);
  });

  it("reports a missing folder instead of throwing", () => {
    expect(validatePackageFolder(join(tmpdir(), "does-not-exist-xyz")).ok).toBe(false);
  });
});
