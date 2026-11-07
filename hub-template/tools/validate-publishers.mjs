#!/usr/bin/env node
/**
 * Checks every Publisher package under packages/publisher/ and publishers.json:
 * each folder is well formed, and each index entry has the fields the product
 * reads (the product's reader is the authority; this catches mistakes in a PR).
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { checkPublisherFolder } from "./build-publisher.mjs";

const ENTRY_KEYS = ["id", "name", "description", "repository", "tag", "asset", "digest", "verification"];

export function validatePublishers(root) {
  const problems = [];
  const folders = existsSync(join(root, "packages/publisher")) ? readdirSync(join(root, "packages/publisher")) : [];
  const names = new Set();
  for (const folder of folders) {
    try {
      names.add(checkPublisherFolder(join(root, "packages/publisher", folder)).pkg.name);
    } catch (error) {
      problems.push(error.message);
    }
  }
  const indexFile = join(root, "publishers.json");
  if (existsSync(indexFile)) {
    const index = JSON.parse(readFileSync(indexFile, "utf-8"));
    if (index.schemaVersion !== 1 || !Array.isArray(index.packages)) problems.push("publishers.json: expected { schemaVersion: 1, packages: [] }");
    for (const entry of index.packages ?? []) {
      for (const key of ENTRY_KEYS) if (typeof entry[key] !== "string" || !entry[key]) problems.push(`publishers.json ${entry.id ?? "?"}: ${key} is missing`);
      if (!/^sha256:[0-9a-f]{64}$/.test(entry.digest ?? "")) problems.push(`publishers.json ${entry.id}: digest must be sha256:<64 hex>`);
      if (!names.has(entry.id)) problems.push(`publishers.json ${entry.id}: no folder in packages/publisher/ has this package name`);
    }
  }
  return problems;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const problems = validatePublishers(process.argv[2] ?? ".");
  for (const p of problems) console.error(`ERROR ${p}`);
  process.exit(problems.length ? 1 : 0);
}
