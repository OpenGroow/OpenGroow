import { describe, expect, it, vi } from "vitest";
import { RUNTIME_SESSION_TRANSCRIPT_READ_RESULT } from "@opengroow/protocol";
import { handleSessionTranscriptRead } from "../src/commands/session-commands.js";
import type { Command } from "@opengroow/protocol";

function makeDeps(requestGatewayControl: ReturnType<typeof vi.fn>) {
  return {
    gatewayClient: { requestGatewayControl },
    getRuntimeInstanceId: () => "instance-1",
    log: vi.fn(),
    warn: vi.fn(),
  } as any;
}

function makeCommand(payload: Record<string, unknown>): Command {
  return {
    id: "cmd-1",
    type: "runtime.session.transcript.read",
    ts: Date.now(),
    payload,
  };
}

describe("handleSessionTranscriptRead", () => {
  it("returns the parsed transcript on success", async () => {
    const requestGatewayControl = vi.fn().mockResolvedValue({
      agentName: "seo-agent",
      found: true,
      turns: [{ role: "user", text: "Write the report", timestamp: "2026-07-02T10:00:00.000Z" }],
    });
    const deps = makeDeps(requestGatewayControl);

    const event = await handleSessionTranscriptRead(
      makeCommand({ agentName: "seo-agent", sessionKey: "mega-run-abc123" }),
      deps,
    );

    expect(requestGatewayControl).toHaveBeenCalledWith("/session/transcript", {
      agentName: "seo-agent",
      sessionKey: "mega-run-abc123",
    });
    expect(event.event.type).toBe(RUNTIME_SESSION_TRANSCRIPT_READ_RESULT);
    expect(event.event.payload).toMatchObject({
      ok: true,
      data: {
        agentName: "seo-agent",
        found: true,
        turns: [{ role: "user", text: "Write the report" }],
      },
    });
  });

  it("fails fast when agentName is missing, without calling the gateway", async () => {
    const requestGatewayControl = vi.fn();
    const deps = makeDeps(requestGatewayControl);

    const event = await handleSessionTranscriptRead(
      makeCommand({ sessionKey: "mega-run-abc123" }),
      deps,
    );

    expect(requestGatewayControl).not.toHaveBeenCalled();
    expect(event.event.payload).toMatchObject({
      ok: false,
      error: "agentName and sessionKey are required",
    });
  });

  it("fails fast when sessionKey is missing, without calling the gateway", async () => {
    const requestGatewayControl = vi.fn();
    const deps = makeDeps(requestGatewayControl);

    const event = await handleSessionTranscriptRead(
      makeCommand({ agentName: "seo-agent" }),
      deps,
    );

    expect(requestGatewayControl).not.toHaveBeenCalled();
    expect(event.event.payload).toMatchObject({
      ok: false,
      error: "agentName and sessionKey are required",
    });
  });

  it("surfaces gateway errors without throwing", async () => {
    const requestGatewayControl = vi.fn().mockRejectedValue(new Error("boom"));
    const deps = makeDeps(requestGatewayControl);

    const event = await handleSessionTranscriptRead(
      makeCommand({ agentName: "seo-agent", sessionKey: "mega-run-abc123" }),
      deps,
    );

    expect(event.event.payload).toMatchObject({
      ok: false,
      error: "boom",
      data: { agentName: "seo-agent", found: false, turns: [] },
    });
  });
});
