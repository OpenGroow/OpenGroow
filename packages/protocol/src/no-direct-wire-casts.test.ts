import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

// Guard for the removal of the legacy Runtime codec ("Supprimer le codec Runtime historique"):
// once every network seam goes through parseValidatedMessage/parseRuntimeResult,
// nothing outside this package should cast an unvalidated value directly to a
// wire message type. This test fails loudly if a new direct cast reappears.

const repoRoot = join(__dirname, "..", "..", "..");
const scannedDirs = [
  "apps/broker/src",
  "apps/openclaw-runtime-worker/src",
  "apps/convex",
];

// Casts that reinterpret an *already-validated* codec result (e.g. narrowing
// a discriminated union after parseValidatedMessage/parseRuntimeResult ran)
// are not wire casts and are allowed here.
const allowedPattern = /as Extract<ReturnType<typeof parse(ValidatedMessage|RuntimeResult)>/;

const forbiddenCastPattern = /as unknown as (Message|Command|Event)\b|as Message\b|as Command\b|as Event\b/;

function listSourceFiles(dir: string): string[] {
  let entries: ReturnType<typeof readdirSync>;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      files.push(...listSourceFiles(path));
    } else if (/\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith(".test.ts")) {
      files.push(path);
    }
  }
  return files;
}

describe("no direct wire casts outside the codec", () => {
  it("finds no unvalidated cast to a wire message type in broker/worker/convex", () => {
    const violations: string[] = [];
    for (const dir of scannedDirs) {
      const absoluteDir = join(repoRoot, dir);
      if (statSync(absoluteDir, { throwIfNoEntry: false }) === undefined) continue;
      for (const file of listSourceFiles(absoluteDir)) {
        const source = readFileSync(file, "utf8");
        for (const line of source.split("\n")) {
          if (allowedPattern.test(line)) continue;
          if (forbiddenCastPattern.test(line)) {
            violations.push(`${relative(repoRoot, file)}: ${line.trim()}`);
          }
        }
      }
    }
    expect(violations, violations.join("\n")).toEqual([]);
  });
});
