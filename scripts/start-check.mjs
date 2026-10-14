#!/usr/bin/env node
// `pnpm start` pre-flight (#718): verify .env before pulling any image.
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv, requiredKeys } from "./setup.mjs";

// registry[:port]/org[/sub], no scheme, no trailing slash.
const REGISTRY_PATTERN = /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?(:\d+)?\/[a-z0-9][a-z0-9._/-]*[a-z0-9]$/;

export function checkStartEnv(root, processEnv = process.env) {
  const problems = [];
  const envPath = join(root, ".env");
  if (!existsSync(envPath)) {
    return { problems: [".env is missing. Create it with: pnpm run setup"] };
  }
  const current = parseEnv(readFileSync(envPath, "utf8"));
  const example = readFileSync(join(root, ".env.example"), "utf8");
  for (const key of requiredKeys(example)) {
    if (!current[key]) problems.push(`${key} is empty in .env (REQUIRED section).`);
  }
  const registry = processEnv.OPENCLAW_IMAGE_REGISTRY || current.OPENCLAW_IMAGE_REGISTRY;
  if (!registry) {
    problems.push(
      "OPENCLAW_IMAGE_REGISTRY is not set. Set it in .env to the registry and organization that host the published images (e.g. ghcr.io/<org>).",
    );
  } else if (!REGISTRY_PATTERN.test(registry)) {
    problems.push(
      `OPENCLAW_IMAGE_REGISTRY="${registry}" is invalid: expected lowercase <registry>/<org> without scheme or trailing slash (e.g. ghcr.io/<org>; Docker refuses uppercase references).`,
    );
  }
  // openclaw-local-control runs with the Docker socket mounted: anyone who can
  // sign a request to it controls this machine. Never run it on a default key.
  const secret = processEnv.OPENCLAW_START_CONTROL_SECRET || current.OPENCLAW_START_CONTROL_SECRET;
  if (!secret || secret === "convex-secret" || secret.length < 32) {
    problems.push(
      "OPENCLAW_START_CONTROL_SECRET is missing, default or too short (needs 32+ characters): openclaw-local-control mounts the Docker socket and must not run on a default key. Generate one with: pnpm run setup",
    );
  }
  return { problems };
}

/** One value, shell first then .env (what compose resolves); parsed as data, never sourced. */
export function readEnvValue(root, key, processEnv = process.env) {
  if (processEnv[key]) return processEnv[key];
  const envPath = join(root, ".env");
  return existsSync(envPath) ? (parseEnv(readFileSync(envPath, "utf8"))[key] ?? "") : "";
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(fileURLToPath(import.meta.url), "../..");
  if (process.argv[2] === "--get") {
    process.stdout.write(readEnvValue(root, process.argv[3] ?? ""));
    process.exit(0);
  }
  const { problems } = checkStartEnv(root);
  if (problems.length) {
    console.error(`pnpm start cannot continue:\n${problems.map((p) => `  - ${p}`).join("\n")}`);
    process.exit(1);
  }
}
