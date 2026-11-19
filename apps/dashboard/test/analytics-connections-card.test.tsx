/** @vitest-environment jsdom */

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AdapterForm, AnalyticsConnectionsCard, useInstallPublishersAnalytics } from "../src/components/analytics-connections-card";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Seam 3: `analytics_connections.list` is simulated; we observe what the card saves.
const OPTION = { key: "lookbackDays", label: "Look-back window (days)", type: "number", default: 7, min: 1, max: 90 };
let adapters: unknown[] | undefined;
let publishers: unknown[] | undefined;
const save = vi.fn(async (..._args: unknown[]) => "id");
const remove = vi.fn(async (..._args: unknown[]) => undefined);
const catalogue = vi.fn(async (..._args: unknown[]) => ({ entries: [] as unknown[] }));
const install = vi.fn(async (..._args: unknown[]) => ({ status: "installed" }));

vi.mock("convex/react", () => ({
  useQuery: (name: unknown) => (name === "analytics_connections.list" ? adapters : name === "publisher_packages.list" ? publishers : undefined),
  useMutation: (name: string) => (name === "analytics_connections.save" ? save : remove),
  useAction: (name: string) => (name === "hub_packages_node.catalogue" ? catalogue : install),
}));
vi.mock("@convex/_generated/api", () => ({
  api: {
    analytics_connections: { list: "analytics_connections.list", save: "analytics_connections.save", remove: "analytics_connections.remove" },
    publisher_packages: { list: "publisher_packages.list" },
    hub_packages_node: { catalogue: "hub_packages_node.catalogue", install: "hub_packages_node.install" },
  },
}));

describe("Analytics connections card", () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    adapters = [{ adapter: "postiz", name: "Postiz", publisher: "postiz", optionDecls: [OPTION], configured: false }];
    publishers = [];
    save.mockClear();
    remove.mockClear();
    catalogue.mockClear();
    install.mockClear();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  const render = () => act(async () => root.render(<AnalyticsConnectionsCard instanceId="inst-1" />));
  // The form of an adapter that belongs to a Publisher: the Publisher's page shows it as a tab.
  const renderEmbedded = () => act(async () => root.render(<AdapterForm instanceId="inst-1" adapter={adapters![0] as never} embedded />));
  const type = async (id: string, value: string) => {
    const input = document.getElementById(id) as HTMLInputElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  };
  const button = (label: string) => Array.from(document.body.querySelectorAll("button")).find((b) => b.textContent?.includes(label))!;

  it("shows nothing while loading", async () => {
    adapters = undefined;
    await render();
    expect(container.textContent).toBe("");
  });

  it("says Connected or Not connected, like a Publisher's card", async () => {
    adapters = [{ adapter: "ga", name: "Google Analytics", optionDecls: [], configured: false }];
    await render();
    expect(container.textContent).toContain("Not connected");
    adapters = [{ adapter: "ga", name: "Google Analytics", optionDecls: [], configured: true, url: "https://ga.example.com", hasApiKey: true }];
    await render();
    expect(container.textContent).toContain("Connected");
    expect(container.textContent).not.toContain("Own connection");
  });

  it("leaves the adapters of a Publisher to that Publisher's page", async () => {
    await render();
    expect(container.textContent).toBe("");
  });

  it("saves only the options inside the Publisher's page, which already holds the connection", async () => {
    await renderEmbedded();
    expect(document.getElementById("analytics-url-postiz")).toBeNull();
    expect(document.getElementById("analytics-key-postiz")).toBeNull();
    expect(container.textContent).toContain("set in Configuration");
    await type("analytics-option-postiz-lookbackDays", "30");
    await act(async () => button("Save changes").click());
    expect(save).toHaveBeenCalledWith({ instanceId: "inst-1", adapter: "postiz", options: { lookbackDays: 30 } });
  });

  it("saves the URL, the key and the options of an adapter that belongs to no Publisher", async () => {
    adapters = [{ adapter: "ga", name: "Google Analytics", optionDecls: [OPTION], configured: false }];
    await render();
    await type("analytics-url-ga", "https://analytics.example.com");
    await type("analytics-key-ga", "secret");
    await type("analytics-option-ga-lookbackDays", "30");
    await act(async () => button("Save changes").click());
    expect(save).toHaveBeenCalledWith({
      instanceId: "inst-1",
      adapter: "ga",
      url: "https://analytics.example.com",
      apiKey: "secret",
      options: { lookbackDays: 30 },
    });
  });

  it("never fills the key back and keeps the stored one when none is typed", async () => {
    adapters = [{ adapter: "postiz", name: "Postiz", optionDecls: [OPTION], configured: true, url: "https://p.example.com", hasApiKey: true, options: { lookbackDays: 14 } }];
    await render();
    expect((document.getElementById("analytics-key-postiz") as HTMLInputElement).value).toBe("");
    expect((document.getElementById("analytics-option-postiz-lookbackDays") as HTMLInputElement).value).toBe("14");
    await act(async () => button("Save changes").click());
    expect(save).toHaveBeenCalledWith({ instanceId: "inst-1", adapter: "postiz", url: "https://p.example.com", options: { lookbackDays: 14 } });
  });

  describe("an adapter that declares a JSON secret and no URL (ADR-079)", () => {
    const SECRET = { label: "Service account key", kind: "json", fields: ["client_email"] };
    beforeEach(() => {
      adapters = [{ adapter: "gsc", name: "Search Console", optionDecls: [], configured: false, needsUrl: false, secret: SECRET }];
    });
    const typeArea = async (id: string, value: string) => {
      const area = document.getElementById(id) as HTMLTextAreaElement;
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(area, value);
        area.dispatchEvent(new Event("input", { bubbles: true }));
      });
    };

    it("shows no URL field and a multi-line secret field, and saves without a URL", async () => {
      await render();
      expect(document.getElementById("analytics-url-gsc")).toBeNull();
      expect(container.textContent).toContain("Service account key");
      expect(document.getElementById("analytics-key-gsc")?.tagName).toBe("TEXTAREA");
      await typeArea("analytics-key-gsc", '{"client_email":"a@b"}');
      await act(async () => button("Save changes").click());
      expect(save).toHaveBeenCalledWith({ instanceId: "inst-1", adapter: "gsc", apiKey: '{"client_email":"a@b"}', options: {} });
    });

    it("fills the field from a chosen file, in the browser only", async () => {
      await render();
      const file = new File(['{"client_email":"from-file"}'], "key.json", { type: "application/json" });
      const input = container.querySelector('input[type="file"]') as HTMLInputElement;
      expect(button("Choose a file")).toBeDefined();
      Object.defineProperty(input, "files", { value: [file] });
      await act(async () => {
        input.dispatchEvent(new Event("change", { bubbles: true }));
        await new Promise((r) => setTimeout(r, 10));
      });
      expect((document.getElementById("analytics-key-gsc") as HTMLTextAreaElement).value).toBe('{"client_email":"from-file"}');
      expect(save).not.toHaveBeenCalled();
    });

    it("never shows the saved secret, only that it is configured", async () => {
      adapters = [{ adapter: "gsc", name: "Search Console", optionDecls: [], configured: true, hasApiKey: true, url: "", options: {}, needsUrl: false, secret: SECRET }];
      await render();
      expect((document.getElementById("analytics-key-gsc") as HTMLTextAreaElement).value).toBe("");
      expect((document.getElementById("analytics-key-gsc") as HTMLTextAreaElement).placeholder).toMatch(/configured/i);
    });
  });

  it("removes a configured connection", async () => {
    adapters = [{ adapter: "postiz", name: "Postiz", optionDecls: [], configured: true, url: "https://p.example.com", hasApiKey: true, options: {} }];
    await render();
    expect(container.textContent).toContain("Danger zone");
    await act(async () => button("Remove").click());
    expect(remove).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("Readings already taken are kept");
    await act(async () => button("Remove Postiz").click());
    expect(remove).toHaveBeenCalledWith({ instanceId: "inst-1", adapter: "postiz" });
  });

  it("has no Danger zone for an adapter that is not configured, nor inside a Publisher's page", async () => {
    adapters = [{ adapter: "ga", name: "GA", optionDecls: [], configured: false }];
    await render();
    expect(container.textContent).not.toContain("Danger zone");
    adapters = [{ adapter: "postiz", name: "Postiz", publisher: "postiz", optionDecls: [], configured: true, url: "https://p.example.com", hasApiKey: true, options: {} }];
    await renderEmbedded();
    expect(container.textContent).not.toContain("Danger zone");
    expect(container.querySelector('[data-testid="package-updates"]')).toBeNull();
  });

  describe("Version", () => {
    const PKG = { packageId: "@opengroow/analytics-ga", version: "1.0.0", digest: `sha256:${"a".repeat(64)}` };
    const entry = (tag: string, digest = PKG.digest) => ({ packageId: PKG.packageId, name: "GA", description: "", tag, verification: "official", digest });
    beforeEach(() => {
      adapters = [{ adapter: "ga", name: "GA", optionDecls: [], configured: false, ...PKG }];
    });

    it("reads the hub on Check for updates, then installs the newer version as an analytics package", async () => {
      await render();
      expect(container.textContent).toContain("Current version1.0.0");
      expect(catalogue).not.toHaveBeenCalled();
      catalogue.mockResolvedValueOnce({ entries: [entry("analytics-ga@1.1.0")] });
      await act(async () => button("Check for updates").click());
      expect(catalogue).toHaveBeenCalledWith({ kind: "analytics" });
      expect(container.textContent).toContain("1.1.0 available");
      await act(async () => button("Update to 1.1.0").click());
      expect(install).toHaveBeenCalledWith({ kind: "analytics", packageId: PKG.packageId });
    });

    it("says Up to date when version and digest match", async () => {
      await render();
      catalogue.mockResolvedValueOnce({ entries: [entry("analytics-ga@1.0.0")] });
      await act(async () => button("Check for updates").click());
      expect(container.textContent).toContain("Up to date");
    });

    it("offers a Reinstall when the same version was republished with another digest", async () => {
      await render();
      catalogue.mockResolvedValueOnce({ entries: [entry("analytics-ga@1.0.0", `sha256:${"b".repeat(64)}`)] });
      await act(async () => button("Check for updates").click());
      expect(container.textContent).toContain("Update available");
      await act(async () => button("Reinstall").click());
      expect(install).toHaveBeenCalledWith({ kind: "analytics", packageId: PKG.packageId });
    });
  });

  it("installs the analytics package of an installed Publisher on its own, once", async () => {
    adapters = [];
    publishers = [{ adapter: "postiz" }];
    catalogue.mockResolvedValue({
      entries: [
        { packageId: "@opengroow/analytics-postiz", name: "Postiz", description: "" },
        { packageId: "@opengroow/analytics-other", name: "Other", description: "" },
      ],
    });
    const Probe = () => {
      useInstallPublishersAnalytics((adapters as Array<{ adapter: string }>).map((a) => a.adapter));
      return null;
    };
    await act(async () => root.render(<Probe />));
    await act(async () => root.render(<Probe />));
    expect(install).toHaveBeenCalledTimes(1);
    expect(install).toHaveBeenCalledWith({ kind: "analytics", packageId: "@opengroow/analytics-postiz" });
    catalogue.mockResolvedValue({ entries: [] });
  });
});
