import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const defaultEnvFile = resolve(__dirname, "../.env.local");
const defaultLocalConvexConfigFile = resolve(__dirname, "../../../.convex/local/default/config.json");

export function loadOpenClawConnectEnvFile(
  path = process.env.OPENCLAW_CONNECT_ENV_FILE ?? defaultEnvFile,
): void {
  if (!path || !existsSync(path)) {
    return;
  }

  const content = readFileSync(path, "utf8");
  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const idx = line.indexOf("=");
    if (idx === -1) {
      continue;
    }

    const key = line.slice(0, idx).trim();
    if (!key || process.env[key] !== undefined) {
      continue;
    }

    let value = line.slice(idx + 1).trim();
    if (
      (value.startsWith("\"") && value.endsWith("\"")) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }

  hydrateLocalConvexAdminKey();
}

function hydrateLocalConvexAdminKey(): void {
  const currentToken = process.env.CONVEX_TOKEN?.trim();
  if (currentToken && currentToken !== "dev-convex-token") {
    return;
  }

  if (!existsSync(defaultLocalConvexConfigFile)) {
    return;
  }

  try {
    const parsed = JSON.parse(readFileSync(defaultLocalConvexConfigFile, "utf8")) as {
      adminKey?: unknown;
    };
    const adminKey =
      typeof parsed.adminKey === "string" ? parsed.adminKey.trim() : "";
    if (adminKey) {
      process.env.CONVEX_TOKEN = adminKey;
    }
  } catch {
    // Keep the existing env value if the local Convex config is unreadable.
  }
}
