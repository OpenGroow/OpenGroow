/** @vitest-environment jsdom */

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AdapterForm, AddAnalyticsButton, AnalyticsConnectionsCard } from "../src/components/analytics-connections-card";

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

  it("removes a configured connection", async () => {
    adapters = [{ adapter: "postiz", name: "Postiz", optionDecls: [], configured: true, url: "https://p.example.com", hasApiKey: true, options: {} }];
    await render();
    await act(async () => button("Remove").click());
    expect(remove).toHaveBeenCalledWith({ instanceId: "inst-1", adapter: "postiz" });
  });

  it("offers the hub's adapters that are not installed", async () => {
    adapters = [];
    catalogue.mockResolvedValueOnce({ entries: [{ packageId: "@opengroow/analytics-postiz", name: "Postiz", description: "Postiz statistics" }] });
    await act(async () => root.render(<AddAnalyticsButton instanceId="inst-1" />));
    await act(async () => button("Add analytics").click());
    await act(async () => button("Postiz analytics").click());
    expect(install).toHaveBeenCalledWith({ kind: "analytics", packageId: "@opengroow/analytics-postiz" });
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
    await render();
    await render();
    expect(install).toHaveBeenCalledTimes(1);
    expect(install).toHaveBeenCalledWith({ kind: "analytics", packageId: "@opengroow/analytics-postiz" });
    catalogue.mockResolvedValue({ entries: [] });
  });
});
