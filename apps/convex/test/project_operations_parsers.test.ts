import { describe, expect, it } from "vitest";
import {
  parseRuntimeNodesCheckPayload,
  parseRuntimeNodesPendingPayload,
  parseRuntimeWhatsAppConfigPayload,
  parseRuntimeWhatsAppPairPayload,
} from "../runtime_commands_node_parsers";

describe("Project operation runtime decoders", () => {
  it("decodes the enabled flag from a WhatsApp config result", () => {
    expect(
      parseRuntimeWhatsAppConfigPayload("runtime.whatsapp.config.set.result", {
        commandId: "cmd-1",
        instanceId: "instance-1",
        ok: true,
        data: { output: "WhatsApp channel disabled.", enabled: false },
      }),
    ).toMatchObject({ ok: true, data: { enabled: false } });
  });


  it("decodes a pending-node result into a typed request list", () => {
    expect(
      parseRuntimeNodesPendingPayload("runtime.nodes.pending.result", {
        commandId: "cmd-1",
        instanceId: "instance-1",
        ok: true,
        data: { output: "{}", requestIds: ["request-1"] },
      }),
    ).toMatchObject({ ok: true, data: { requestIds: ["request-1"] } });
  });

  it("rejects malformed node results instead of inventing defaults", () => {
    expect(
      parseRuntimeNodesPendingPayload("runtime.nodes.pending.result", {
        commandId: "cmd-1",
        instanceId: "instance-1",
        ok: true,
        data: { output: "{}", requestIds: [42] },
      }),
    ).toBeNull();
  });

  it("decodes connected devices with their capabilities", () => {
    expect(
      parseRuntimeNodesCheckPayload("runtime.nodes.check.result", {
        commandId: "cmd-2",
        instanceId: "instance-1",
        ok: true,
        data: {
          connectedCount: 1,
          nodes: [{ displayName: "Phone", caps: ["camera", "mic"] }],
        },
      }),
    ).toMatchObject({
      ok: true,
      data: { connectedCount: 1, nodes: [{ displayName: "Phone", caps: ["camera", "mic"] }] },
    });
  });

  it("keeps how long the QR stays valid, and ignores a value that is not a number", () => {
    const result = (qrExpiresInMs: unknown) => ({
      commandId: "cmd-1",
      instanceId: "instance-1",
      ok: true,
      data: { output: "", linked: false, connected: false, qrDataUrl: "data:image/svg+xml;base64,QR", qrExpiresInMs },
    });
    const read = (qrExpiresInMs: unknown) => {
      const parsed = parseRuntimeWhatsAppPairPayload("runtime.whatsapp.pair.wait.result", result(qrExpiresInMs));
      return parsed && "qrExpiresInMs" in parsed.data ? parsed.data.qrExpiresInMs : undefined;
    };

    expect(read(8_000)).toBe(8_000);
    expect(read(-5)).toBe(0);
    expect(read("8000")).toBeUndefined();
    expect(read(Number.NaN)).toBeUndefined();
  });

  it("keeps the refreshed QR of a WhatsApp pair.wait result, as it does for pair.start", () => {
    const payload = {
      commandId: "cmd-1",
      instanceId: "instance-1",
      ok: true,
      data: { output: "not linked", linked: false, connected: false, qrDataUrl: "data:image/svg+xml;base64,QR2" },
    };

    for (const type of ["runtime.whatsapp.pair.start.result", "runtime.whatsapp.pair.wait.result"]) {
      const parsed = parseRuntimeWhatsAppPairPayload(type, payload);
      expect(parsed && "qrDataUrl" in parsed.data ? parsed.data.qrDataUrl : undefined).toBe(
        "data:image/svg+xml;base64,QR2",
      );
    }
  });
});
