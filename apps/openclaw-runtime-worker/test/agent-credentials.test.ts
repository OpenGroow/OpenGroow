import { describe, expect, it, vi } from "vitest";
import { RUNTIME_AGENT_CREDENTIAL_SET } from "@opengroow/protocol";
import { handleAgentCredentialSet } from "../src/commands/agent-credentials.js";

function makeCommand(payload: Record<string, unknown>) {
  return { id: "cmd-agent-credential", type: RUNTIME_AGENT_CREDENTIAL_SET, ts: Date.now(), payload } as any;
}

describe("handleAgentCredentialSet", () => {
  it("stores a credential without returning or logging its value", async () => {
    const writeCredential = vi.fn().mockResolvedValue(undefined);
    const deps = {
      writeAgentCredential: writeCredential,
      getRuntimeInstanceId: () => "instance-1",
      log: vi.fn(),
      warn: vi.fn(),
    } as any;

    const event = await handleAgentCredentialSet(
      makeCommand({ agentId: "engagement", apiKey: "secret-key" }),
      deps,
    );

    expect(writeCredential).toHaveBeenCalledWith("engagement", "secret-key");
    expect(event.event.payload).toMatchObject({ ok: true, data: { agentId: "engagement" } });
    expect(JSON.stringify(event)).not.toContain("secret-key");
    expect(deps.log).not.toHaveBeenCalledWith(expect.stringContaining("secret-key"));
  });

  it("stores the credential of any Agent under its own id, without knowing its Template (issue #658)", async () => {
    const writeCredential = vi.fn().mockResolvedValue(undefined);
    const deps = { writeAgentCredential: writeCredential, getRuntimeInstanceId: () => "instance-1", log: vi.fn(), warn: vi.fn() } as any;

    const event = await handleAgentCredentialSet(makeCommand({ agentId: "other-agent", apiKey: "k" }), deps);

    expect(writeCredential).toHaveBeenCalledWith("other-agent", "k");
    expect(event.event.payload).toMatchObject({ ok: true, data: { agentId: "other-agent" } });
  });

  it("rejects a payload without agentId without touching storage", async () => {
    const writeCredential = vi.fn();
    const deps = { writeAgentCredential: writeCredential, getRuntimeInstanceId: () => "instance-1", log: vi.fn(), warn: vi.fn() } as any;

    const event = await handleAgentCredentialSet(makeCommand({ apiKey: "k" }), deps);

    expect(writeCredential).not.toHaveBeenCalled();
    expect(event.event.payload).toMatchObject({ ok: false, error: "agentId is required" });
  });

  it("rejects an incomplete payload without touching storage", async () => {
    const writeCredential = vi.fn();
    const deps = { writeAgentCredential: writeCredential, getRuntimeInstanceId: () => "instance-1", log: vi.fn(), warn: vi.fn() } as any;

    const event = await handleAgentCredentialSet(makeCommand({ agentId: "engagement" }), deps);

    expect(writeCredential).not.toHaveBeenCalled();
    expect(event.event.payload).toMatchObject({ ok: false });
  });
});
