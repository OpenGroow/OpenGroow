import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
// @ts-expect-error plain .mjs module
import { checkStartEnv, readEnvValue } from "./start-check.mjs";

const EXAMPLE = `# ===== REQUIRED =====
COMPOSE_FILE=a:b
# ===== OPTIONAL =====
OPENCLAW_IMAGE_REGISTRY=
OPENCLAW_START_CONTROL_SECRET=
`;
const SECRET = "OPENCLAW_START_CONTROL_SECRET=" + "f".repeat(48);

function repo(dotenv: string | null): string {
  const root = mkdtempSync(join(tmpdir(), "start-check-"));
  writeFileSync(join(root, ".env.example"), EXAMPLE);
  if (dotenv !== null) writeFileSync(join(root, ".env"), dotenv);
  return root;
}

describe("readEnvValue", () => {
  it("reads .env as data (no shell evaluation), the shell wins", () => {
    const root = repo('DASHBOARD_URL=http://x:1\nEVIL=$(touch /tmp/pwned)\nQUOTED="a b"\n');
    expect(readEnvValue(root, "DASHBOARD_URL", {})).toBe("http://x:1");
    expect(readEnvValue(root, "EVIL", {})).toBe("$(touch /tmp/pwned)");
    expect(readEnvValue(root, "QUOTED", {})).toBe("a b");
    expect(readEnvValue(root, "DASHBOARD_URL", { DASHBOARD_URL: "http://shell" })).toBe("http://shell");
    expect(readEnvValue(repo(null), "X", {})).toBe("");
  });
});

describe("scripts/start.sh", () => {
  const script = join(__dirname, "start.sh");

  it("validates the action before anything else", () => {
    const r = spawnSync("bash", [script, "bogus"], { encoding: "utf8" });
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/usage/);
  });

  it("does not source .env as shell", () => {
    expect(readFileSync(script, "utf8")).not.toMatch(/^\s*(source|\.)\s+\.env/m);
  });
});

describe("checkStartEnv", () => {
  it("reports a missing .env and points to the setup command", () => {
    const { problems } = checkStartEnv(repo(null), {});
    expect(problems.join("\n")).toMatch(/\.env/);
    expect(problems.join("\n")).toMatch(/pnpm run setup/);
  });

  it("reports empty REQUIRED variables", () => {
    const { problems } = checkStartEnv(repo("COMPOSE_FILE=\nOPENCLAW_IMAGE_REGISTRY=ghcr.io/acme\n" + SECRET + "\n"), {});
    expect(problems.join("\n")).toMatch(/COMPOSE_FILE/);
  });

  it("requires an image registry, with no hard-coded default", () => {
    const { problems } = checkStartEnv(repo("COMPOSE_FILE=a:b\n"), {});
    expect(problems.join("\n")).toMatch(/OPENCLAW_IMAGE_REGISTRY/);
  });

  it("rejects a registry with a trailing slash or a scheme", () => {
    for (const bad of ["ghcr.io/acme/", "https://ghcr.io/acme", "acme", "ghcr.io/Acme", "GHCR.io/acme"]) {
      const { problems } = checkStartEnv(repo(`COMPOSE_FILE=a:b\nOPENCLAW_IMAGE_REGISTRY=${bad}\n`), {});
      expect(problems.join("\n")).toMatch(/OPENCLAW_IMAGE_REGISTRY/);
    }
  });


  it("refuses to start without a generated, non-default control secret (docker.sock exposure)", () => {
    const base = "COMPOSE_FILE=a:b\nOPENCLAW_IMAGE_REGISTRY=ghcr.io/acme\n";
    for (const bad of ["", "OPENCLAW_START_CONTROL_SECRET=\n", "OPENCLAW_START_CONTROL_SECRET=convex-secret\n", "OPENCLAW_START_CONTROL_SECRET=short\n"]) {
      const { problems } = checkStartEnv(repo(base + bad), {});
      expect(problems.join("\n")).toMatch(/OPENCLAW_START_CONTROL_SECRET/);
    }
  });

  it("accepts a complete .env, and a registry given by the process environment", () => {
    expect(checkStartEnv(repo("COMPOSE_FILE=a:b\nOPENCLAW_IMAGE_REGISTRY=ghcr.io/acme\n" + SECRET + "\n"), {}).problems).toEqual([]);
    expect(
      checkStartEnv(repo("COMPOSE_FILE=a:b\n" + SECRET + "\n"), { OPENCLAW_IMAGE_REGISTRY: "localhost:5000/acme" }).problems,
    ).toEqual([]);
  });
});
