/**
 * `pnpm template:validate-index <index.json>`
 *
 * Validates a hub index with the parser the product uses (#672): strict keys,
 * digest format, valid tags and asset names, scope reservation. For the CI of
 * a hub repository. Exit code 0 when valid, 1 otherwise.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseHubIndex } from "../src/hub-index.js";

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const file = process.argv[2];
  if (!file) {
    console.error("Usage: template:validate-index <index.json>");
    process.exit(1);
  }
  let json: unknown;
  try {
    json = JSON.parse(readFileSync(resolve(process.env.INIT_CWD ?? process.cwd(), file), "utf-8"));
  } catch (error) {
    console.error(`ERROR ${file}: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }
  const parsed = parseHubIndex(json);
  if (parsed.ok) console.log(`OK ${parsed.index.packages.length} package(s)`);
  else console.error(`ERROR ${file}: ${parsed.reason}`);
  process.exit(parsed.ok ? 0 : 1);
}
