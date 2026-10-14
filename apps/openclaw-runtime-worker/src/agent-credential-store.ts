import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { CREDENTIALS_FILE } from "./credential-paths.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readCredentials(path: string): Promise<Record<string, string>> {
  try {
    const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
    if (!isRecord(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].length > 0),
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
}

export function createAgentCredentialWriter(configDir: string) {
  const path = join(configDir, CREDENTIALS_FILE);

  return async (agentId: string, apiKey: string): Promise<void> => {
    const credentials = await readCredentials(path);
    if (apiKey) credentials[agentId] = apiKey;
    else delete credentials[agentId];

    // The runtime-worker runs as root but the gateway reads this file as uid 1000: a 0700/0600
    // root-owned file made every classifier call fail with missing_credentials. The volume is
    // only mounted in this Project's own containers, so world-readable inside it is acceptable.
    const directory = join(configDir, "opengroow");
    await mkdir(directory, { recursive: true, mode: 0o755 });
    await chmod(directory, 0o755);
    const temporaryPath = `${path}.tmp-${process.pid}`;
    await writeFile(temporaryPath, `${JSON.stringify(credentials)}\n`, { encoding: "utf8", mode: 0o644 });
    await chmod(temporaryPath, 0o644);
    await rename(temporaryPath, path);
  };
}
