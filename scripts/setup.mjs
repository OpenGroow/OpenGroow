#!/usr/bin/env node
// `pnpm run setup` (#715): create .env from .env.example, then report which
// REQUIRED variables are still empty. Never overwrites an existing .env.
// Note: plain `pnpm setup` is a pnpm built-in (shell setup), so use `pnpm run setup`.
import { randomBytes } from "node:crypto";
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function parseEnv(text) {
  const values = {};
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const idx = line.indexOf("=");
    if (idx === -1) continue;
    values[line.slice(0, idx).trim()] = line.slice(idx + 1).trim().replace(/^(["'])(.*)\1$/, "$2");
  }
  return values;
}

/** Keys declared in the REQUIRED section of .env.example. */
export function requiredKeys(exampleText) {
  const keys = [];
  let inRequired = false;
  for (const line of exampleText.split("\n")) {
    const header = line.match(/^#\s*=+\s*(REQUIRED|OPTIONAL|GENERATED)\b/);
    if (header) inRequired = header[1] === "REQUIRED";
    else if (inRequired && /^[A-Z][A-Z0-9_]*=/.test(line)) keys.push(line.split("=")[0]);
  }
  return keys;
}

/** Secrets `pnpm run setup` generates when .env.example declares them and .env leaves them empty. */
const GENERATED_SECRETS = ["OPENCLAW_START_CONTROL_SECRET"];

function fillGeneratedSecrets(envPath, exampleText) {
  let text = readFileSync(envPath, "utf8");
  const current = parseEnv(text);
  const generated = [];
  for (const key of GENERATED_SECRETS) {
    if (!new RegExp(`^${key}=`, "m").test(exampleText) || current[key]) continue;
    const value = randomBytes(32).toString("hex");
    const line = new RegExp(`^${key}=.*$`, "m");
    text = line.test(text) ? text.replace(line, `${key}=${value}`) : `${text.replace(/\n?$/, "\n")}${key}=${value}\n`;
    generated.push(key);
  }
  if (generated.length) writeFileSync(envPath, text);
  return generated;
}

export function runSetup(root) {
  const example = join(root, ".env.example");
  const target = join(root, ".env");
  const created = !existsSync(target);
  if (created) copyFileSync(example, target);
  const current = parseEnv(readFileSync(target, "utf8"));
  const exampleText = readFileSync(example, "utf8");
  const generated = fillGeneratedSecrets(target, exampleText);
  const missing = requiredKeys(exampleText).filter((key) => !current[key]);
  return { created, missing, generated };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(fileURLToPath(import.meta.url), "../..");
  const { created, missing, generated } = runSetup(root);
  console.log(created ? "Created .env from .env.example." : ".env already exists, left untouched.");
  if (generated.length) console.log(`Generated in .env: ${generated.join(", ")} (never share or commit it).`);
  if (missing.length) {
    console.log(`Still to fill in .env (REQUIRED section):\n${missing.map((k) => `  - ${k}`).join("\n")}`);
  } else {
    console.log("All REQUIRED variables are set. Next: pnpm dev");
  }
}
