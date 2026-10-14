import { describe, expect, it, vi } from "vitest";
import type { Command } from "@opengroow/protocol";
import { handleWhatsAppConfigSet, handleWhatsAppPairWait } from "../src/commands/whatsapp-commands.js";

function makeCommand(payload: Record<string, unknown>): Command {
  return { id: "cmd-1", type: "runtime.whatsapp.config.set", ts: Date.now(), payload };
}

function makeDeps(applyWhatsAppConfig = vi.fn().mockResolvedValue(undefined)) {
  return {
    gatewayClient: { applyWhatsAppConfig },
    getRuntimeInstanceId: () => "instance-1",
    log: vi.fn(),
  } as any;
}

describe("handleWhatsAppConfigSet", () => {
  it("disables the channel and forwards enabled through to the gateway client", async () => {
    const applyWhatsAppConfig = vi.fn().mockResolvedValue(undefined);
    const result = await handleWhatsAppConfigSet(
      makeCommand({ enabled: false }),
      makeDeps(applyWhatsAppConfig),
    );

    expect(applyWhatsAppConfig).toHaveBeenCalledWith("", false);
    expect((result.event.payload as any).ok).toBe(true);
    expect((result.event.payload as any).data.output).toBe("WhatsApp channel disabled.");
    // Regression: Convex's parseRuntimeWhatsAppConfigPayload only persists
    // `enabled` when it's present as a boolean in `data` — omitting it here
    // silently reverted the toggle back to its previous stored value.
    expect((result.event.payload as any).data.enabled).toBe(false);
  });

  it("still sets a phone number the same way when enabled isn't part of the call", async () => {
    const applyWhatsAppConfig = vi.fn().mockResolvedValue(undefined);
    const result = await handleWhatsAppConfigSet(
      makeCommand({ phoneNumber: "+33612345678" }),
      makeDeps(applyWhatsAppConfig),
    );

    expect(applyWhatsAppConfig).toHaveBeenCalledWith("+33612345678", undefined);
    expect((result.event.payload as any).data.output).toBe(
      "WhatsApp number saved for +33612345678.",
    );
  });
});

describe("handleWhatsAppPairWait", () => {
  it("forwards the current QR so the dashboard can refresh it while the user scans", async () => {
    // WhatsApp rotates the QR every ~20 s; if the check drops it, the screen keeps
    // showing the first one and the scan is refused.
    const requestGatewayControl = vi.fn().mockResolvedValue({
      output: "account:default, not linked",
      linked: false,
      connected: false,
      qrDataUrl: "data:image/svg+xml;base64,REFRESHED",
    });
    const deps = { ...makeDeps(), gatewayClient: { requestGatewayControl } };

    const result = await handleWhatsAppPairWait(
      { id: "cmd-2", type: "runtime.whatsapp.pair.wait", ts: Date.now(), payload: { timeoutMs: 3000 } },
      deps,
    );

    expect((result.event.payload as any).ok).toBe(true);
    expect((result.event.payload as any).data.qrDataUrl).toBe("data:image/svg+xml;base64,REFRESHED");
  });
});
