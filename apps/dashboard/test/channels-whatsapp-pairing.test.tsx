/** @vitest-environment jsdom */

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChannelsPageContent } from "../src/components/channels-page-content";
import { OptionalPluginsProvider } from "../src/components/optional-plugins-provider";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const startWhatsAppPairing = vi.fn();
const waitWhatsAppPairing = vi.fn();
const actions: Record<string, unknown> = {};

vi.mock("convex/react", () => ({
  useAction: (name: string) => actions[name] ?? vi.fn(),
}));
vi.mock("@convex/_generated/api", () => ({
  api: {
    project_channel_operations: {
      configureTelegram: "configureTelegram",
      configureSpeechToText: "configureSpeechToText",
      startWhatsAppPairing: "startWhatsAppPairing",
      waitWhatsAppPairing: "waitWhatsAppPairing",
      configureWhatsApp: "configureWhatsApp",
    },
  },
}));
vi.mock("@/src/hooks/use-authenticated-instances", () => ({
  useAuthenticatedInstances: () => [
    {
      jobId: "job-1",
      openclawId: "instance-1",
      whatsAppChannel: { phoneNumber: "+33600000000", enabled: true, linked: false, connected: false },
    },
  ],
}));

describe("WhatsApp pairing on the Channels page", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    startWhatsAppPairing.mockReset();
    waitWhatsAppPairing.mockReset();
    actions.startWhatsAppPairing = startWhatsAppPairing;
    actions.waitWhatsAppPairing = waitWhatsAppPairing;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () =>
      root.render(
        <OptionalPluginsProvider plugins={["whatsapp"]}>
          <ChannelsPageContent resolvedInstanceId="instance-1" />
        </OptionalPluginsProvider>,
      ),
    );
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  function findButton(label: string): HTMLButtonElement | undefined {
    return Array.from(container.querySelectorAll("button")).find((b) => b.textContent === label);
  }

  // "Pair WhatsApp" opens the pairing steps; "Generate QR Code" starts the pairing.
  async function clickGenerate(): Promise<void> {
    await act(async () => findButton("Pair WhatsApp")?.click());
    await act(async () => findButton("Generate QR Code")?.click());
  }

  it("shows the QR on the first click instead of declaring it expired", async () => {
    startWhatsAppPairing.mockResolvedValue({
      ok: true,
      output: "Waiting for WhatsApp connection...",
      linked: false,
      connected: false,
      qrDataUrl: "data:image/png;base64,AAAA",
    });

    await clickGenerate();

    expect(container.querySelector('img[src^="data:image"]')).not.toBeNull();
    expect(container.textContent).not.toContain("QR expired");
  });

  it("shows the real error when the pairing cannot start", async () => {
    startWhatsAppPairing.mockResolvedValue({
      ok: false,
      output: "",
      linked: false,
      connected: false,
      error: "openclaw channels login exited before QR was generated",
    });

    await clickGenerate();

    expect(container.textContent).toContain("openclaw channels login exited before QR was generated");
    expect(container.textContent).not.toContain("QR expired");
  });

  it("keeps refreshing the QR while the user scans, instead of stopping after the first check", async () => {
    vi.useFakeTimers();
    try {
      startWhatsAppPairing.mockResolvedValue({
        ok: true,
        output: "",
        linked: false,
        connected: false,
        qrDataUrl: "data:image/png;base64,FIRST",
      });
      let call = 0;
      waitWhatsAppPairing.mockImplementation(async () => ({
        ok: true,
        output: "account:default, not linked",
        linked: false,
        connected: false,
        qrDataUrl: `data:image/png;base64,REFRESH${++call}`,
      }));

      await clickGenerate();
      expect(container.querySelector("img")?.getAttribute("src")).toContain("FIRST");

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1600);
      });
      expect(container.querySelector("img")?.getAttribute("src")).toContain("REFRESH1");

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1600);
      });
      expect(container.querySelector("img")?.getAttribute("src")).toContain("REFRESH2");
      expect(container.textContent).not.toContain("QR expired");
    } finally {
      vi.useRealTimers();
    }
  });

  it("dims the QR once the Instance's expiry has passed and undims it with the next one", async () => {
    vi.useFakeTimers();
    try {
      startWhatsAppPairing.mockResolvedValue({
        ok: true,
        output: "",
        linked: false,
        connected: false,
        qrDataUrl: "data:image/png;base64,FIRST",
        qrExpiresInMs: 4_000,
      });
      let call = 0;
      waitWhatsAppPairing.mockImplementation(async () => {
        call += 1;
        // The first checks answer with the QR that is about to expire; the
        // fourth brings a new one.
        return {
          ok: true,
          output: "not linked",
          linked: false,
          connected: false,
          qrDataUrl: call < 4 ? "data:image/png;base64,FIRST" : "data:image/png;base64,SECOND",
          qrExpiresInMs: call < 4 ? 1 : 20_000,
        };
      });

      await clickGenerate();
      const imgClass = () => container.querySelector("img")?.getAttribute("class") ?? "";
      expect(imgClass()).not.toContain("opacity-30");
      expect(container.textContent).not.toContain("Refreshing the QR code");

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1_600);
      });
      // The check that just answered said the QR has 1 ms left.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(50);
      });
      expect(imgClass()).toContain("opacity-30");
      expect(container.textContent).toContain("Refreshing the QR code");

      await act(async () => {
        await vi.advanceTimersByTimeAsync(4_800);
      });
      expect(container.querySelector("img")?.getAttribute("src")).toContain("SECOND");
      expect(imgClass()).not.toContain("opacity-30");
    } finally {
      vi.useRealTimers();
    }
  });
});
