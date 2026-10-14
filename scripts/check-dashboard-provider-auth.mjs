import { readFile, readdir } from "node:fs/promises";
import { join, extname } from "node:path";

// Architecture guard for issue #392: providers-page-content.tsx and
// burst-instance-panel.tsx must not reintroduce a private Provider Auth
// lifecycle (their own authJobs-style state + manual polling) instead of
// consuming the single apps/dashboard/src/hooks/use-provider-auth.ts hook.
// Run standalone via `pnpm check:dashboard-provider-auth`; also asserted
// against the real repo tree by scripts/check-dashboard-provider-auth.test.ts.

const guardedRelativeFiles = [
  "apps/dashboard/src/components/providers-page-content.tsx",
  "apps/dashboard/src/components/burst-instance-panel.tsx",
];
// A manual Auth poll is a setInterval sitting near a getAuthJob call, in
// either order (`setInterval(poll, …)` with the poll defined below, or an
// inline `setInterval(() => { … getAuthJob(…) }, …)`). The proximity window
// is deliberately tight so the components' unrelated intervals — WhatsApp
// pairing, runtime commands — do not trip the guard.
const forbidden = [
  /\bsetAuthJobs\b/,
  /\buseState[^;]*authJobs\b/,
  /\bconst\s+\[\s*authJob[s]?\s*,/,
  /(window\.)?setInterval\([\s\S]{0,400}?getAuthJob/,
  /getAuthJob[\s\S]{0,400}?(window\.)?setInterval\(/,
];

// A guarded component may have been split into a component.tsx plus a
// same-named component/ subdirectory of section files (e.g.
// burst-instance-panel.tsx + burst-instance-panel/). Reads and concatenates
// every source file belonging to the component — file layout is an
// implementation detail; the contract is about the component as a whole,
// not any one file within it.
async function readComponentSource(baseDir, relativeFile) {
  const mainPath = join(baseDir, relativeFile);
  let source = await readFile(mainPath, "utf8");

  const subDir = mainPath.replace(/\.tsx?$/, "");
  let entries;
  try {
    entries = await readdir(subDir, { withFileTypes: true });
  } catch {
    return source;
  }
  for (const entry of entries) {
    if (!entry.isFile() || ![".ts", ".tsx"].includes(extname(entry.name))) continue;
    source += "\n" + (await readFile(join(subDir, entry.name), "utf8"));
  }
  return source;
}

// baseDir defaults to process.cwd() (the repo root, when run normally) but
// can be overridden so tests can point this at a synthetic fixture tree
// without process.chdir() — unsupported inside vitest worker threads.
export async function findViolations(baseDir = process.cwd()) {
  const violations = [];
  for (const relativeFile of guardedRelativeFiles) {
    const source = await readComponentSource(baseDir, relativeFile);
    for (const pattern of forbidden) {
      if (pattern.test(source)) violations.push(`${relativeFile}: ${pattern}`);
    }
    if (!/useProviderAuth/.test(source)) {
      violations.push(`${relativeFile}: does not use the shared useProviderAuth() hook`);
    }
  }
  return violations;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const violations = await findViolations();
  if (violations.length > 0) {
    console.error("Dashboard Provider Auth lifecycle contract violated:");
    for (const violation of violations) console.error(`- ${violation}`);
    process.exitCode = 1;
  } else {
    console.log("Dashboard Provider Auth lifecycle contract passed.");
  }
}
