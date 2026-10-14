import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = "apps/openclaw-docker-config";

function listFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (name === "node_modules" || name === ".git") return [];
    const path = join(dir, name);
    return statSync(path).isDirectory() ? listFiles(path) : [path];
  });
}

describe("openclaw-docker-config is a generic product folder", () => {
  it("references no hosted control app path", () => {
    const offenders = listFiles(root).filter(
      (file) =>
        file !== join(root, "test", "image-build-generic.test.ts") &&
        /apps\/openclaw-control/.test(readFileSync(file, "utf8")),
    );
    expect(offenders).toEqual([]);
  });

  it("build-and-push scripts have no organization-specific default", () => {
    for (const script of ["build-and-push.sh", "build-and-push-runtime-worker.sh"]) {
      const source = readFileSync(join(root, "scripts", script), "utf8");
      expect(source).not.toMatch(/GHCR_USERNAME/);
      expect(source).not.toMatch(/ghcr\.io\/[^$\s]/);
      expect(source).toContain("OPENCLAW_IMAGE_REGISTRY");
    }
  });

  it("build-and-push scripts fail clearly when the registry is unset", () => {
    for (const script of ["build-and-push.sh", "build-and-push-runtime-worker.sh"]) {
      const env = { ...process.env };
      delete env.OPENCLAW_IMAGE_REGISTRY;
      const result = spawnSync("bash", [join(root, "scripts", script)], {
        env,
        encoding: "utf8",
      });
      expect(result.status).not.toBe(0);
      expect(result.stderr + result.stdout).toContain("OPENCLAW_IMAGE_REGISTRY");
    }
  });

  it("root image scripts read the root .env", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8"));
    for (const name of ["openclaw:image:gateway", "openclaw:image:runtime-worker"]) {
      expect(pkg.scripts[name]).not.toContain("openclaw-control");
      expect(pkg.scripts[name]).toContain("dotenv -e .env");
    }
  });
});
