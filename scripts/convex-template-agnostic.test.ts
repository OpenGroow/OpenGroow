import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * CI guard (#663, PRD #642 story 43): Convex code never names a specific
 * Template. Template-aware behavior is declared by the Template (manifest
 * fields) or lives in a named context provider the Template references; it is
 * never a branch on a Template id. Data migrations are the one exception: they
 * rewrite stored ids and must name them. Tests are exempt.
 */
const CONVEX_DIR = join(import.meta.dirname, "..", "apps", "convex");
const EXEMPT_DIRS = new Set(["_generated", "node_modules", "test"]);
const EXEMPT_FILES = new Set(["migrations.ts"]);
const isMigrationFile = (relPath: string) => /(^|\/)migrations?(\/|\.|_)/.test(relPath) || EXEMPT_FILES.has(relPath);
const isTestFile = (relPath: string) => /\.test\.tsx?$/.test(relPath);

/** The official Template ids, each with its bare name when distinctive (hyphenated), and Social Engagement by name. */
const OFFICIAL_TEMPLATE_IDS = [
  "hello",
  "moneyprinterturbo",
  "openmontage-agent",
  "seo",
  "social-engagement",
  "source",
  "video-demo",
  "visual-social",
].map((name) => `@opengroow/${name}`);

export function forbiddenTemplateNames(ids: readonly string[] = OFFICIAL_TEMPLATE_IDS): string[] {
  const names = new Set<string>(["social-engagement"]);
  for (const id of ids) {
    names.add(id);
    const bare = id.replace(/^@[^/]+\//, "");
    if (bare.includes("-")) names.add(bare);
  }
  return [...names];
}

export function convexSourceFiles(dir: string = CONVEX_DIR): string[] {
  const files: string[] = [];
  const walk = (current: string) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!EXEMPT_DIRS.has(entry.name)) walk(join(current, entry.name));
      } else if (/\.tsx?$/.test(entry.name)) {
        const rel = relative(dir, join(current, entry.name)).split("\\").join("/");
        if (!isTestFile(rel) && !isMigrationFile(rel)) files.push(rel);
      }
    }
  };
  walk(dir);
  return files.sort();
}

describe("Convex names no specific Template (#663)", () => {
  it("knows the former built-in Template ids it guards", () => {
    const names = forbiddenTemplateNames();
    expect(names).toEqual(expect.arrayContaining(["social-engagement", "@opengroow/social-engagement", "@opengroow/seo", "video-demo"]));
  });

  it("scans the Convex sources, skipping generated code, tests and migrations", () => {
    const files = convexSourceFiles();
    expect(files).toContain("mission_dispatcher_node.ts");
    expect(files.some((f) => f.startsWith("_generated/") || f.startsWith("test/") || f === "migrations.ts")).toBe(false);
  });

  it("finds no Template id in any Convex file outside migrations and tests", () => {
    const names = forbiddenTemplateNames();
    const violations: string[] = [];
    for (const file of convexSourceFiles()) {
      readFileSync(join(CONVEX_DIR, file), "utf-8")
        .split("\n")
        .forEach((line, index) => {
          const name = names.find((candidate) => line.includes(candidate));
          if (name) violations.push(`apps/convex/${file}:${index + 1} names "${name}"`);
        });
    }
    expect(violations).toEqual([]);
  });
});
