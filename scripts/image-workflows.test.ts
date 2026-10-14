import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const dir = join(__dirname, "..", ".github", "workflows");
const imageWorkflows = readdirSync(dir).filter((f) => f.endsWith("-image.yml"));

describe("image workflows (#718)", () => {
  it("covers every image pulled by docker-compose.start.yml", () => {
    const start = readFileSync(join(__dirname, "..", "docker-compose.start.yml"), "utf8");
    const pulled = [...start.matchAll(/\}\/(opengroow-[a-z-]+):/g)].map((m) => m[1]);
    const published = imageWorkflows.map((f) => readFileSync(join(dir, f), "utf8").match(/IMAGE_NAME: (\S+)/)?.[1]);
    expect(pulled.length).toBeGreaterThan(0);
    for (const image of pulled) expect(published).toContain(image);
  });

  it.each(imageWorkflows)("%s takes its registry from a variable, not a hard-coded org", (file) => {
    const text = readFileSync(join(dir, file), "utf8");
    expect(text).toContain("vars.IMAGE_REGISTRY");
    expect(text).toContain("github.repository_owner");
    expect(text).not.toMatch(/ghcr\.io\/(?!\{0\})[A-Za-z0-9_-]+\//);
  });
});
