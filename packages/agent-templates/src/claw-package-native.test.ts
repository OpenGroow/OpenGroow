import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

/**
 * Guard: the package fixtures are valid NATIVE OpenClaw Claws, not a OpenGroow
 * dialect. Each is validated by OpenClaw itself (`openclaw claws add --dry-run`,
 * read-only, in the gateway image), so a drift from OpenClaw's schema fails here
 * instead of when a package is first added to a real OpenClaw.
 *
 * Skipped when docker or the gateway image is unavailable (CI without docker
 * stays green). Build the image with `pnpm openclaw:local`.
 */
const IMAGE = process.env.OPENGROOW_OPENCLAW_IMAGE ?? "opengroow/openclaw-gateway:local";

const PACKAGES: Record<string, string> = {
  "engagement": join(import.meta.dirname, "..", "..", "..", "fixtures", "packages", "engagement"),
  seo: join(import.meta.dirname, "__fixtures__", "claw", "seo"),
};

function unavailableReason(): string | undefined {
  const probe = spawnSync("docker", ["image", "inspect", IMAGE], { stdio: "ignore", timeout: 15_000 });
  if (probe.error) return "docker is not available";
  if (probe.status !== 0) return `image ${IMAGE} is not available (build it with "pnpm openclaw:local")`;
  return undefined;
}

const skipReason = unavailableReason();
if (skipReason) console.warn(`[claw-package-native] native Claw validation skipped: ${skipReason}`);

type Diagnostic = { level: string; code: string; path?: string; message: string };
type Plan = { valid?: boolean; diagnostics?: Diagnostic[]; blockers?: unknown[] };

function dryRun(dir: string): Plan {
  const run = spawnSync(
    "docker",
    [
      "run", "--rm", "--entrypoint", "openclaw",
      "-e", "OPENCLAW_EXPERIMENTAL_CLAWS=1",
      "-v", `${dir}:/pkg:ro`,
      IMAGE,
      "claws", "add", "/pkg", "--agent-id", "native-check", "--workspace", "/tmp/native-check-ws", "--dry-run", "--json",
    ],
    { encoding: "utf-8", timeout: 120_000 },
  );
  try {
    return JSON.parse(run.stdout) as Plan;
  } catch {
    throw new Error(`openclaw claws add did not return JSON (exit ${run.status}): ${run.stdout}${run.stderr}`);
  }
}

describe.skipIf(skipReason !== undefined)("package fixtures are valid native OpenClaw Claws", () => {
  it.each(Object.entries(PACKAGES))("%s", (_name, dir) => {
    const plan = dryRun(dir);
    const errors = (plan.diagnostics ?? []).filter((d) => d.level === "error");
    // Warnings (e.g. no online ClawHub preflight) are acceptable; errors and blockers are not.
    expect(errors.map((d) => `${d.path ?? ""}: ${d.message}`)).toEqual([]);
    expect(plan.blockers ?? []).toEqual([]);
    expect(plan.valid).not.toBe(false);
  });
});
