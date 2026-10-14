import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// An agent plugin delivers a per-agent secret to a paired Node host through an
// `LC_`-prefixed exec env var (for example a key of the social-engagement package):
// the `LC_` prefix is the only door the Node host leaves open for shell-wrapped
// commands. This fails if a future OpenClaw closes it.
describe("OpenClaw shell-wrapper env allowlist", () => {
  it("still allows LC_* variables", () => {
    const docs = readFileSync(
      fileURLToPath(new URL("../node_modules/openclaw/docs/nodes/index.md", import.meta.url)),
      "utf8",
    );
    const rule = docs.split("\n").find((line) => line.includes("shell wrappers") && line.includes("allowlist"));
    expect(rule, "OpenClaw no longer documents the shell-wrapper env allowlist").toBeDefined();
    expect(rule).toContain("`LC_*`");
  });
});
