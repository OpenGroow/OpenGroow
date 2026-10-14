import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
// @ts-expect-error plain .mjs module
import { parseEnv, runSetup } from "./setup.mjs";

const EXAMPLE = `# ===== REQUIRED =====
ANTHROPIC_API_KEY=
COMPOSE_FILE=a.yml
# ===== OPTIONAL =====
TELEGRAM_BOT_TOKEN=
# ===== GENERATED, do not set =====
BROKER_SECRET=
`;

function project() {
  const root = mkdtempSync(join(tmpdir(), "setup-"));
  writeFileSync(join(root, ".env.example"), EXAMPLE);
  return root;
}

describe("pnpm run setup (#715)", () => {
  it("creates .env from .env.example and reports empty REQUIRED keys only", () => {
    const root = project();
    const result = runSetup(root);
    expect(result.created).toBe(true);
    expect(readFileSync(join(root, ".env"), "utf8")).toBe(EXAMPLE);
    expect(result.missing).toEqual(["ANTHROPIC_API_KEY"]);
  });

  it("never overwrites an existing .env", () => {
    const root = project();
    writeFileSync(join(root, ".env"), "ANTHROPIC_API_KEY=sk-x\nCOMPOSE_FILE=a.yml\n");
    const result = runSetup(root);
    expect(result.created).toBe(false);
    expect(readFileSync(join(root, ".env"), "utf8")).toContain("sk-x");
    expect(result.missing).toEqual([]);
  });

  it("generates the start control secret when declared, and keeps an existing one", () => {
    const root = mkdtempSync(join(tmpdir(), "setup-secret-"));
    writeFileSync(join(root, ".env.example"), `${EXAMPLE}OPENCLAW_START_CONTROL_SECRET=\n`);
    const first = runSetup(root);
    expect(first.generated).toEqual(["OPENCLAW_START_CONTROL_SECRET"]);
    const secret = parseEnv(readFileSync(join(root, ".env"), "utf8")).OPENCLAW_START_CONTROL_SECRET;
    expect(secret).toMatch(/^[0-9a-f]{64}$/);
    expect(runSetup(root).generated).toEqual([]);
    expect(parseEnv(readFileSync(join(root, ".env"), "utf8")).OPENCLAW_START_CONTROL_SECRET).toBe(secret);
  });

  it("parseEnv ignores comments and blank lines", () => {
    expect(parseEnv("# c\n\nA=1\nB=\n")).toEqual({ A: "1", B: "" });
  });
});
