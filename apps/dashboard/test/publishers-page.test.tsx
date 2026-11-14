/** @vitest-environment jsdom */

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import PublishersPage from "../app/(app)/projects/[projectId]/publishers/page";
import { INSTALLED_PUBLISHERS, PUBLISHER_PACKAGES_LIST } from "./postiz-installed";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const useQueryMock = vi.fn();
// What `publisher_packages.list` returns: reassigned by a test to simulate an install.
let installedPublishers: Array<(typeof INSTALLED_PUBLISHERS)[number] & { connectionUrlLabel?: string }> = INSTALLED_PUBLISHERS;
const mutations: Record<string, ReturnType<typeof vi.fn<any[], any>>> = {};
const actions: Record<string, ReturnType<typeof vi.fn<any[], any>>> = {};

// `publishers.list`: a test's single Publisher (or null for none) is the Project's only one (ADR-075).
const asPublisherList = (value: unknown) => (value === undefined ? undefined : value === null ? [] : Array.isArray(value) ? value : [value]);
vi.mock("convex/react", () => ({
  useQuery: (...args: unknown[]) =>
    args[0] === PUBLISHER_PACKAGES_LIST ? installedPublishers : args[0] === "publishers.list" ? asPublisherList(useQueryMock(...args)) : useQueryMock(...args),
  useMutation: (name: string) => (mutations[name] ??= vi.fn(async () => "key")),
  useAction: (name: string) => (actions[name] ??= vi.fn(async () => ({ ok: true, channels: [] }))),
}));
vi.mock("@convex/_generated/api", () => {
  const names = (group: string, fns: string[]) =>
    Object.fromEntries(fns.map((f) => [f, `${group}.${f}`]));
  return {
    api: {
      publishers: names("publishers", ["list", "save", "remove", "addChannel", "updateSettings", "removeTarget"]),
      publishers_node: names("publishers_node", ["testConnection", "listChannels"]),
      hub_packages_node: names("hub_packages_node", ["catalogue", "install"]),
      publisher_packages: names("publisher_packages", ["list"]),
    },
  };
});
vi.mock("@/src/hooks/use-authenticated-instances", () => ({
  useAuthenticatedInstances: () => [{ openclawId: "inst-1" }],
}));
vi.mock("@/src/hooks/use-resolved-project-id", () => ({ useResolvedProjectId: () => "inst-1" }));
vi.mock("@/src/components/instance-workspace.utils", () => ({
  findInstanceById: (instances: Array<{ openclawId: string }>) => instances[0],
}));

const PUBLISHER = {
  adapter: "postiz",
  url: "https://postiz.example.com",
  hasApiKey: true,
  targets: [
    { target: "instagram:myinsta", mapped: true, channelId: "c1", channelName: "My IG", channelService: "instagram", channelProfile: "myinsta" },
    { target: "threads:me", mapped: true, channelId: "c2", channelName: "Me", channelService: "threads", channelProfile: "me" },
  ],
};

describe("Publishers page", () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    useQueryMock.mockReset();
    installedPublishers = INSTALLED_PUBLISHERS;
    for (const k of Object.keys(mutations)) delete mutations[k];
    for (const k of Object.keys(actions)) delete actions[k];
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  async function render() {
    await act(async () => {
      root.render(<PublishersPage params={Promise.resolve({ projectId: "inst-1" })} />);
    });
  }
  const text = () => document.body.textContent ?? "";
  const byText = (label: string) =>
    Array.from(document.body.querySelectorAll<HTMLElement>("button")).find((b) => b.textContent?.trim().startsWith(label));
  const click = async (el: Element | undefined) => {
    await act(async () => {
      (el as HTMLElement).click();
    });
  };

  it("switches between the Configuration and Channels tabs, the latter showing the channel count", async () => {
    useQueryMock.mockReturnValue(PUBLISHER);
    actions["publishers_node.testConnection"] = vi.fn(async () => ({ ok: true }));
    await render();
    expect(text()).toContain("Postiz URL");
    expect(byText("Channels")?.textContent).toBe("Channels (2)");
    await click(byText("Channels"));
    expect(text()).not.toContain("Postiz URL");
    expect(text()).toContain("@myinsta");
    expect(text()).not.toContain("My IG");
    await click(byText("Configuration"));
    expect(text()).toContain("Postiz URL");
  });

  it("uses the package's connection label while keeping its publisher title", async () => {
    installedPublishers = [{ ...INSTALLED_PUBLISHERS[0], adapter: "github", name: "Blog Utils (GitHub)", connectionUrlLabel: "GitHub account URL" }];
    useQueryMock.mockReturnValue({ ...PUBLISHER, adapter: "github" });
    await render();
    expect(text()).toContain("Blog Utils (GitHub)");
    expect(document.querySelector('label[for="publisher-url-github"]')?.textContent).toBe("GitHub account URL");
  });

  it("reads the hub only on Check for updates, then offers the newer version and installs it on Update", async () => {
    useQueryMock.mockReturnValue(PUBLISHER);
    actions["publishers_node.testConnection"] = vi.fn(async () => ({ ok: true }));
    const entry = { packageId: "@opengroow/publisher-postiz", name: "Postiz", description: "", tag: "publisher-postiz@1.0.2", verification: "official" };
    actions["hub_packages_node.catalogue"] = vi.fn(async () => ({ entries: [entry] }));
    actions["hub_packages_node.install"] = vi.fn(async () => ({ status: "installed", packageId: entry.packageId, version: "1.0.2" }));
    await render();
    expect(text()).toContain("Current version1.0.0");
    expect(actions["hub_packages_node.catalogue"]).not.toHaveBeenCalled();

    await click(byText("Check for updates"));
    expect(text()).toContain("1.0.2 available");
    await click(byText("Update to 1.0.2"));
    expect(actions["hub_packages_node.install"]).toHaveBeenCalledWith({ kind: "publisher", packageId: entry.packageId });
  });

  it("says Up to date for the installed version, and reports a hub that cannot be read", async () => {
    useQueryMock.mockReturnValue(PUBLISHER);
    actions["publishers_node.testConnection"] = vi.fn(async () => ({ ok: true }));
    actions["hub_packages_node.catalogue"] = vi.fn(async () => ({
      entries: [{ packageId: "@opengroow/publisher-postiz", name: "Postiz", description: "", tag: "publisher-postiz@1.0.0", verification: "official" }],
    }));
    await render();
    await click(byText("Check for updates"));
    expect(text()).toContain("Up to date");
    expect(byText("Update to")).toBeUndefined();

    actions["hub_packages_node.catalogue"] = vi.fn(async () => ({ entries: [], error: "offline" }));
    await act(async () => root.unmount());
    root = createRoot(container);
    await render();
    await click(byText("Check for updates"));
    expect(text()).toContain("The hub could not be read: offline");
    expect(byText("Update to")).toBeUndefined();
  });

  it("shows Connected or Not connected following the connection test", async () => {
    useQueryMock.mockReturnValue(PUBLISHER);
    actions["publishers_node.testConnection"] = vi.fn(async () => ({ ok: true }));
    await render();
    expect(text()).toContain("Connected");
    expect(text()).not.toContain("Not connected");
    await act(async () => root.unmount());
    root = createRoot(container);
    for (const k of Object.keys(actions)) delete actions[k];
    actions["publishers_node.testConnection"] = vi.fn(async () => ({ ok: false, error: "401" }));
    await render();
    expect(text()).toContain("Not connected");
  });

  it("shows what is typed in the API key field only after toggling visibility", async () => {
    useQueryMock.mockReturnValue(PUBLISHER);
    await render();
    const input = document.getElementById("publisher-api-key-postiz") as HTMLInputElement;
    expect(input.type).toBe("password");
    await click(document.querySelector('[aria-label="Show API key"]') ?? undefined);
    expect((document.getElementById("publisher-api-key-postiz") as HTMLInputElement).type).toBe("text");
    await click(document.querySelector('[aria-label="Hide API key"]') ?? undefined);
    expect((document.getElementById("publisher-api-key-postiz") as HTMLInputElement).type).toBe("password");
  });

  it("still offers Add publisher once a Publisher exists, listing only the services not added yet (ADR-075)", async () => {
    useQueryMock.mockReturnValue(PUBLISHER);
    actions["hub_packages_node.catalogue"] = vi.fn(async () => ({
      entries: [
        { packageId: "@opengroow/publisher-postiz", name: "Postiz", description: "" },
        { packageId: "@opengroow/publisher-github", name: "GitHub", description: "" },
      ],
    }));
    await render();
    expect((byText("Add publisher") as HTMLButtonElement).disabled).toBe(false);
    await click(byText("Add publisher"));
    const options = [...document.querySelectorAll('[role="dialog"] button')].map((b) => b.textContent ?? "");
    expect(options.some((o) => o.includes("GitHub"))).toBe(true);
    expect(options.some((o) => o.includes("Postiz"))).toBe(false);
  });

  it("says so when every publisher of the hub is already added", async () => {
    useQueryMock.mockReturnValue(PUBLISHER);
    actions["hub_packages_node.catalogue"] = vi.fn(async () => ({ entries: [{ packageId: "@opengroow/publisher-postiz", name: "Postiz", description: "" }] }));
    await render();
    await click(byText("Add publisher"));
    expect(text()).toContain("Every publisher of the hub is already added.");
  });

  it("shows one card per Publisher of the Project, each with its own connection", async () => {
    useQueryMock.mockReturnValue([
      PUBLISHER,
      { adapter: "github", url: "https://api.github.com", hasApiKey: false, targets: [] },
    ]);
    await render();
    expect(document.querySelector('[data-testid="publisher-postiz"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="publisher-github"]')?.textContent).toContain("API key missing");
    expect((document.getElementById("publisher-url-github") as HTMLInputElement).value).toBe("https://api.github.com");
    expect((document.getElementById("publisher-url-postiz") as HTMLInputElement).value).toBe("https://postiz.example.com");
  });

  it("removes a Publisher from its Danger zone, after confirming", async () => {
    useQueryMock.mockReturnValue(PUBLISHER);
    await render();
    await click(byText("Remove"));
    expect(text()).toContain("Remove Postiz?");
    expect(document.querySelector('[aria-label="Danger zone"]')?.textContent).toContain("Remove this publisher");
    const confirm = [...document.querySelectorAll('[role="dialog"] button')].find((b) => b.textContent === "Remove Postiz");
    await click(confirm);
    expect(mutations["publishers.remove"]).toHaveBeenCalledWith({ instanceId: "inst-1", adapter: "postiz" });
  });

  it("offers the hub's Publisher in the Add publisher modal when there is no Publisher", async () => {
    useQueryMock.mockReturnValue(null);
    actions["hub_packages_node.catalogue"] = vi.fn(async () => ({ entries: [{ packageId: "@opengroow/publisher-postiz", name: "Postiz", description: "", icon: "data:image/png;base64,iVBORw0KGgo=" }] }));
    await render();
    expect((byText("Add publisher") as HTMLButtonElement).disabled).toBe(false);
    await click(byText("Add publisher"));
    expect(text()).toContain("Add a publisher");
    await click(byText("Postiz"));
    expect(text()).toContain("Postiz URL");
  });
});

describe("Publishers page: Add publisher (ADR-072)", () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    useQueryMock.mockReset();
    useQueryMock.mockReturnValue(null); // no Publisher yet
    installedPublishers = [];
    for (const k of Object.keys(actions)) delete actions[k];
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  const ICON = "data:image/png;base64,iVBORw0KGgo=";
  const HUB_ENTRY = { packageId: "@opengroow/publisher-postiz", name: "Postiz", description: "Publish through a Postiz instance", icon: ICON };
  const render = async () => {
    await act(async () => {
      root.render(<PublishersPage params={Promise.resolve({ projectId: "inst-1" })} />);
    });
  };
  const text = () => document.body.textContent ?? "";
  const buttons = () => Array.from(document.body.querySelectorAll<HTMLElement>("button"));
  const byText = (label: string) => buttons().find((b) => b.textContent?.trim().startsWith(label));
  const click = async (el: Element | undefined) => {
    await act(async () => {
      (el as HTMLElement).click();
    });
  };
  const openDialog = async () => {
    await render();
    await click(byText("Add publisher"));
  };

  it("shows the logo and label the hub gives each package, before installing it", async () => {
    const icon = ICON;
    actions["hub_packages_node.catalogue"] = vi.fn(async () => ({ entries: [HUB_ENTRY, { packageId: "@opengroow/publisher-noicon", name: "Noicon", description: "" }] }));
    await openDialog();
    const imgs = Array.from(document.body.querySelectorAll("img"));
    expect(imgs.map((i) => i.getAttribute("src"))).toEqual([icon]);
    expect(text()).toContain("Noicon");
    expect(document.body.innerHTML).not.toContain("/postiz.png");
  });

  it("lists what the hub offers", async () => {
    actions["hub_packages_node.catalogue"] = vi.fn(async () => ({ entries: [HUB_ENTRY] }));
    await openDialog();
    expect(actions["hub_packages_node.catalogue"]).toHaveBeenCalledWith({ kind: "publisher" });
    expect(text()).toContain("Postiz");
    expect(text()).toContain("Publish through a Postiz instance");
  });

  it("installs the chosen package, then shows its connection form under the package's name", async () => {
    actions["hub_packages_node.catalogue"] = vi.fn(async () => ({ entries: [HUB_ENTRY] }));
    actions["hub_packages_node.install"] = vi.fn(async () => {
      installedPublishers = INSTALLED_PUBLISHERS; // the reactive query now serves the installed package
      return { status: "installed", packageId: HUB_ENTRY.packageId, version: "1.0.0" };
    });
    await openDialog();
    await click(byText("Postiz"));
    expect(actions["hub_packages_node.install"]).toHaveBeenCalledWith({ kind: "publisher", packageId: HUB_ENTRY.packageId });
    expect(text()).toContain("Postiz URL");
    expect(document.getElementById("publisher-url-postiz")).not.toBeNull();
  });

  it("does not install again a package that is already installed", async () => {
    installedPublishers = INSTALLED_PUBLISHERS;
    actions["hub_packages_node.catalogue"] = vi.fn(async () => ({ entries: [HUB_ENTRY] }));
    actions["hub_packages_node.install"] = vi.fn(async () => ({ status: "installed" }));
    await openDialog();
    await click(byText("Postiz"));
    expect(actions["hub_packages_node.install"]).not.toHaveBeenCalled();
    expect(text()).toContain("Postiz URL");
  });

  it("shows why an install was refused and stays on the choice", async () => {
    actions["hub_packages_node.catalogue"] = vi.fn(async () => ({ entries: [HUB_ENTRY] }));
    actions["hub_packages_node.install"] = vi.fn(async () => ({ status: "error", errorMessage: "Digest mismatch for OpenGroow/groowhub" }));
    await openDialog();
    await click(byText("Postiz"));
    expect(text()).toContain("Digest mismatch");
    expect(document.getElementById("publisher-url-postiz")).toBeNull();
  });

  it("says when the hub cannot be read, and still offers what is installed", async () => {
    installedPublishers = INSTALLED_PUBLISHERS;
    actions["hub_packages_node.catalogue"] = vi.fn(async () => ({ entries: [], error: "HTTP 500" }));
    await openDialog();
    expect(text()).toContain("The hub could not be read: HTTP 500");
    expect(byText("Postiz")).toBeDefined();
  });

  describe("a Publisher whose package is not installed (set up before installable packages)", () => {
    beforeEach(() => {
      useQueryMock.mockReturnValue(PUBLISHER);
      installedPublishers = [];
    });

    it("offers to install the package the hub lists for it, keeping the connection and the channels", async () => {
      actions["hub_packages_node.catalogue"] = vi.fn(async () => ({ entries: [HUB_ENTRY] }));
      actions["hub_packages_node.install"] = vi.fn(async () => {
        installedPublishers = INSTALLED_PUBLISHERS;
        return { status: "installed", packageId: HUB_ENTRY.packageId, version: "1.0.0" };
      });
      await render();
      expect(document.querySelector('[data-testid="package-missing"]')?.textContent).toContain("Postiz is not installed");
      expect(byText("Channels")?.textContent).toBe("Channels (2)");
      await click(byText("Install Postiz"));
      expect(actions["hub_packages_node.install"]).toHaveBeenCalledWith({ kind: "publisher", packageId: HUB_ENTRY.packageId });
      expect(document.querySelector('[data-testid="package-missing"]')).toBeNull();
    });

    it("does not test the connection before the package is installed, then does", async () => {
      actions["hub_packages_node.catalogue"] = vi.fn(async () => ({ entries: [HUB_ENTRY] }));
      actions["publishers_node.testConnection"] = vi.fn(async () => ({ ok: true }));
      actions["hub_packages_node.install"] = vi.fn(async () => {
        installedPublishers = INSTALLED_PUBLISHERS;
        return { status: "installed" };
      });
      await render();
      expect(actions["publishers_node.testConnection"]).not.toHaveBeenCalled();
      expect(text()).not.toContain("Not connected");
      await click(byText("Install Postiz"));
      expect(actions["publishers_node.testConnection"]).toHaveBeenCalled();
      expect(text()).toContain("Connected");
    });

    it("says so when the hub has no package for it, and cannot install", async () => {
      actions["hub_packages_node.catalogue"] = vi.fn(async () => ({ entries: [] }));
      await render();
      expect(text()).toContain('The hub has no package for "postiz"');
      expect((byText("Install") as HTMLButtonElement).disabled).toBe(true);
    });

    it("shows why the install was refused", async () => {
      actions["hub_packages_node.catalogue"] = vi.fn(async () => ({ entries: [HUB_ENTRY] }));
      actions["hub_packages_node.install"] = vi.fn(async () => ({ status: "error", errorMessage: "Digest mismatch" }));
      await render();
      await click(byText("Install Postiz"));
      expect(text()).toContain("Digest mismatch");
      expect(document.querySelector('[data-testid="package-missing"]')).not.toBeNull();
    });
  });
});
