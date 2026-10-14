import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// ADR-064: the product's former name must not come back. Frozen ADRs record
// history and are the only place that may spell it out.
const OLD_NAME = /megaclaw/i;
const EXEMPT = (file: string) => file.startsWith("docs/adr/") || file === "scripts/no-megaclaw-name.test.ts";

const root = join(import.meta.dirname, "..");
const files = execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" })
  .split("\0")
  .filter((file) => file !== "" && !EXEMPT(file));

describe("the former product name", () => {
  it("appears in no tracked path", () => {
    expect(files.filter((file) => OLD_NAME.test(file))).toEqual([]);
  });

  it("appears in no tracked file", () => {
    const offenders = files.filter((file) => {
      try {
        return OLD_NAME.test(readFileSync(join(root, file), "utf8"));
      } catch {
        return false; // deleted in the working tree, or a symlink to nowhere
      }
    });
    expect(offenders).toEqual([]);
  });
});
