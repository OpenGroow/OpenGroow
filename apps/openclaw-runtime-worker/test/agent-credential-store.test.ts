import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createAgentCredentialWriter } from "../src/agent-credential-store.js";
import { CREDENTIALS_FILE } from "../src/credential-paths.js";

function configDir(): string {
  return mkdtempSync(join(tmpdir(), "credential-store-"));
}

describe("createAgentCredentialWriter", () => {
  it("writes the credential under opengroow/", async () => {
    const dir = configDir();
    await createAgentCredentialWriter(dir)("agent-a", "key-a");
    expect(JSON.parse(readFileSync(join(dir, CREDENTIALS_FILE), "utf8"))).toEqual({
      "agent-a": "key-a",
    });
  });

  it("keeps the keys of the other agents when one is added, replaced or removed", async () => {
    const dir = configDir();
    const write = createAgentCredentialWriter(dir);

    await write("agent-a", "key-a");
    await write("agent-b", "key-b");
    await write("agent-a", "new-a");
    await write("agent-b", "");

    expect(JSON.parse(readFileSync(join(dir, CREDENTIALS_FILE), "utf8"))).toEqual({ "agent-a": "new-a" });
  });
});
