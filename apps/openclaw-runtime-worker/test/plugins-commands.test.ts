import { describe, expect, it, vi } from "vitest";
import { RUNTIME_PLUGINS_INSTALL, RUNTIME_PLUGINS_INSTALL_RESULT } from "@opengroow/protocol";
import { handlePluginsInstall } from "../src/commands/plugins-commands.js";

function makeCommand(payload: unknown) {
  return { id: "cmd-plugins", type: RUNTIME_PLUGINS_INSTALL, ts: Date.now(), payload } as any;
}

const plugins = [{ id: "p", files: [{ path: "package.json", content: "{}" }] }];

function makeDeps(requestGatewayControl: ReturnType<typeof vi.fn>) {
  return { gatewayClient: { requestGatewayControl }, getRuntimeInstanceId: () => "instance-1" } as any;
}

describe("handlePluginsInstall (#661)", () => {
  it("forwards the plugins to the control socket and reports which ones changed", async () => {
    const request = vi.fn().mockResolvedValue({ plugins: [{ id: "p", changed: true }] });

    const event = await handlePluginsInstall(makeCommand({ plugins }), makeDeps(request));

    expect(request).toHaveBeenCalledWith("/plugins/install", { plugins });
    expect(event.event.type).toBe(RUNTIME_PLUGINS_INSTALL_RESULT);
    expect(event.event.payload).toMatchObject({
      ok: true,
      instanceId: "instance-1",
      data: { plugins: [{ id: "p", changed: true }] },
    });
  });

  it("rejects a payload without plugins without calling the control socket", async () => {
    const request = vi.fn();

    const event = await handlePluginsInstall(makeCommand({ plugins: [] }), makeDeps(request));

    expect(request).not.toHaveBeenCalled();
    expect(event.event.payload).toMatchObject({ ok: false, data: { plugins: [] } });
  });

  it("reports a control socket failure as a failed result", async () => {
    const request = vi.fn().mockRejectedValue(new Error("unsafe file path"));

    const event = await handlePluginsInstall(makeCommand({ plugins }), makeDeps(request));

    expect(event.event.payload).toMatchObject({ ok: false, error: "unsafe file path", data: { plugins: [] } });
  });
});
