/** @vitest-environment jsdom */

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import PublishersPage from "../app/(app)/projects/[projectId]/publishers/page";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const useQueryMock = vi.fn();
const mutations: Record<string, ReturnType<typeof vi.fn<any[], any>>> = {};
const actions: Record<string, ReturnType<typeof vi.fn<any[], any>>> = {};

vi.mock("convex/react", () => ({
  useQuery: (...args: unknown[]) => useQueryMock(...args),
  useMutation: (name: string) => (mutations[name] ??= vi.fn(async () => "key")),
  useAction: (name: string) => (actions[name] ??= vi.fn(async () => ({ ok: true, channels: [] }))),
}));
vi.mock("@convex/_generated/api", () => {
  const names = (group: string, fns: string[]) =>
    Object.fromEntries(fns.map((f) => [f, `${group}.${f}`]));
  return {
    api: {
      publishers: names("publishers", ["get", "save", "testConnection", "listChannels", "addChannel", "updateSettings", "removeTarget"]),
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
    actions["publishers.testConnection"] = vi.fn(async () => ({ ok: true }));
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

  it("shows Connected or Not connected following the connection test", async () => {
    useQueryMock.mockReturnValue(PUBLISHER);
    actions["publishers.testConnection"] = vi.fn(async () => ({ ok: true }));
    await render();
    expect(text()).toContain("Connected");
    expect(text()).not.toContain("Not connected");
    await act(async () => root.unmount());
    root = createRoot(container);
    for (const k of Object.keys(actions)) delete actions[k];
    actions["publishers.testConnection"] = vi.fn(async () => ({ ok: false, error: "401" }));
    await render();
    expect(text()).toContain("Not connected");
  });

  it("shows what is typed in the API key field only after toggling visibility", async () => {
    useQueryMock.mockReturnValue(PUBLISHER);
    await render();
    const input = document.getElementById("publisher-api-key") as HTMLInputElement;
    expect(input.type).toBe("password");
    await click(document.querySelector('[aria-label="Show API key"]') ?? undefined);
    expect((document.getElementById("publisher-api-key") as HTMLInputElement).type).toBe("text");
    await click(document.querySelector('[aria-label="Hide API key"]') ?? undefined);
    expect((document.getElementById("publisher-api-key") as HTMLInputElement).type).toBe("password");
  });

  it("disables Add publisher once a Publisher exists", async () => {
    useQueryMock.mockReturnValue(PUBLISHER);
    await render();
    expect((byText("Add publisher") as HTMLButtonElement).disabled).toBe(true);
  });

  it("offers Postiz in the Add publisher modal when there is no Publisher", async () => {
    useQueryMock.mockReturnValue(null);
    await render();
    expect((byText("Add publisher") as HTMLButtonElement).disabled).toBe(false);
    await click(byText("Add publisher"));
    expect(text()).toContain("Add a publisher");
    await click(byText("Postiz"));
    expect(text()).toContain("Postiz URL");
  });
});
