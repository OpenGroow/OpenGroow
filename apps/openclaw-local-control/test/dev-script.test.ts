import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const packageJson = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as { scripts?: Record<string, string> };

describe("local-control package scripts", () => {
  it("keeps Docker event watching opt-in instead of enabling it in dev", () => {
    expect(packageJson.scripts?.dev).not.toContain(
      "OPENCLAW_LOCAL_CONTROL_DOCKER_EVENTS=1",
    );
    expect(packageJson.scripts?.["dev:docker-events"]).toContain(
      "OPENCLAW_LOCAL_CONTROL_DOCKER_EVENTS=1",
    );
  });
});
