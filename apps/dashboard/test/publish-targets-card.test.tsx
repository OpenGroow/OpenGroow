/** @vitest-environment jsdom */

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PublishTargetsCard } from "../src/components/publish-targets-card";
import { INSTALLED_PUBLISHERS } from "./postiz-installed";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mutations: Record<string, ReturnType<typeof vi.fn<any[], any>>> = {};
const listChannels = vi.fn();

vi.mock("convex/react", () => ({
  useMutation: (name: string) => (mutations[name] ??= vi.fn(async () => "key")),
  useAction: () => listChannels,
  // The only query the card makes: the installed Publisher packages, whose channel options it renders.
  useQuery: () => INSTALLED_PUBLISHERS,
}));
vi.mock("@convex/_generated/api", () => ({
  api: {
    publishers: {
      get: "publishers.get",
      addChannel: "publishers.addChannel",
      updateSettings: "publishers.updateSettings",
      removeTarget: "publishers.removeTarget",
      setChannelProfiles: "publishers.setChannelProfiles",
    },
    publishers_node: { listChannels: "publishers_node.listChannels" },
    publisher_packages: { list: "publisher_packages.list" },
  },
}));

type Target = {
  target: string; mapped: true; channelId: string; channelName: string; channelService: string; channelProfile: string;
  settings?: Record<string, unknown>;
};
const target = (service: string, id: string, settings?: Record<string, unknown>): Target => ({
  target: `${service}:${id}`, mapped: true, channelId: id, channelName: `${service} name`, channelService: service, channelProfile: id, settings,
});
const publisher = (targets: Target[]) => ({ adapter: "postiz", url: "https://postiz.example.com", hasApiKey: true, targets });

describe("PublishTargetsCard", () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    for (const k of Object.keys(mutations)) delete mutations[k];
    listChannels.mockReset();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  async function render(targets: Target[]) {
    await act(async () => {
      root.render(<PublishTargetsCard instanceId="inst-1" publisher={publisher(targets)} />);
    });
  }
  const text = () => document.body.textContent ?? "";
  const buttons = () => Array.from(document.body.querySelectorAll<HTMLButtonElement>("button"));
  const byText = (label: string) => buttons().find((b) => b.textContent?.includes(label));
  const click = async (el: Element | undefined) => {
    await act(async () => {
      (el as HTMLElement).click();
    });
  };
  const change = async (el: HTMLElement, value: string) => {
    await act(async () => {
      const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value);
      el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
    });
  };

  it("lists in the Add channel modal only channels not yet added, disabling those without a handle", async () => {
    listChannels.mockResolvedValue({
      ok: true,
      channels: [
        { id: "c1", name: "Already", service: "instagram", profile: "already" },
        { id: "c9", name: "Fresh", service: "linkedin", profile: "fresh" },
        { id: "c8", name: "Nameless", service: "x" },
      ],
    });
    await render([{ ...target("instagram", "already"), channelId: "c1" }]);
    await click(byText("Add channel"));
    const dialog = document.body.querySelector('[role="dialog"]')!;
    expect(dialog.textContent).toContain("@fresh");
    expect(dialog.textContent).not.toContain("Already");
    expect(dialog.textContent).toContain("This channel has no handle, so it cannot be added.");
    const option = (name: string) => Array.from(dialog.querySelectorAll("button")).find((b) => b.textContent?.includes(name))!;
    expect(option("@fresh").disabled).toBe(false);
    expect(option("Nameless").disabled).toBe(true);
  });

  it("adds a clicked channel with its data and closes the modal", async () => {
    listChannels.mockResolvedValue({
      ok: true,
      channels: [{ id: "c9", name: "Fresh", service: "linkedin", profile: "fresh" }],
    });
    await render([]);
    await click(byText("Add channel"));
    const dialog = document.body.querySelector('[role="dialog"]')!;
    await click(Array.from(dialog.querySelectorAll("button")).find((b) => b.textContent?.includes("@fresh")));
    expect(mutations["publishers.addChannel"]).toHaveBeenCalledWith({
      instanceId: "inst-1",
      adapter: "postiz",
      channelId: "c9",
      channelName: "Fresh",
      channelService: "linkedin",
      channelProfile: "fresh",
    });
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
  });

  it("saves the Board ID of a Pinterest channel and keeps its other settings", async () => {
    listChannels.mockResolvedValue({ ok: true, channels: [] });
    await render([target("pinterest", "pins", { board: "old", title: "T" })]);
    await click(byText("@pins"));
    const input = document.getElementById("board-pinterest:pins") as HTMLInputElement;
    expect(input.value).toBe("old");
    await act(async () => {
      input.value = "987";
      input.focus();
      input.blur();
    });
    expect(mutations["publishers.updateSettings"]).toHaveBeenCalledWith({
      instanceId: "inst-1",
      adapter: "postiz",
      target: "pinterest:pins",
      settings: { title: "T", board: "987" },
    });
  });

  it("offers TikTok Visibility and Posting method and saves a changed choice", async () => {
    listChannels.mockResolvedValue({ ok: true, channels: [] });
    await render([target("tiktok", "tt", { comment: false })]);
    await click(byText("@tt"));
    const visibility = document.getElementById("privacy_level-tiktok:tt") as HTMLSelectElement;
    const method = document.getElementById("content_posting_method-tiktok:tt") as HTMLSelectElement;
    expect(text()).toContain("Visibility");
    expect(text()).toContain("Posting method");
    expect(Array.from(visibility.options).map((o) => o.value)).toContain("SELF_ONLY");
    expect(Array.from(method.options).map((o) => o.value)).toContain("UPLOAD");
    await change(visibility, "SELF_ONLY");
    expect(mutations["publishers.updateSettings"]).toHaveBeenCalledWith({
      instanceId: "inst-1",
      adapter: "postiz",
      target: "tiktok:tt",
      settings: { comment: false, privacy_level: "SELF_ONLY" },
    });
  });

  it("stores the live handle of a channel added before handles were kept, once, never for one that has it", async () => {
    listChannels.mockResolvedValue({
      ok: true,
      channels: [
        { id: "old", name: "Love You Make", service: "instagram", profile: "love_youmake" },
        { id: "c9", name: "Has one", service: "tiktok", profile: "tt" },
      ],
    });
    const legacy = { ...target("instagram", "old"), target: "instagram", channelProfile: undefined } as unknown as Target;
    await render([legacy, target("tiktok", "c9")]);
    expect(text()).toContain("@love_youmake");
    expect(mutations["publishers.setChannelProfiles"]).toHaveBeenCalledTimes(1);
    expect(mutations["publishers.setChannelProfiles"]).toHaveBeenCalledWith({
      instanceId: "inst-1",
      adapter: "postiz",
      profiles: [{ target: "instagram", channelProfile: "love_youmake" }],
    });
  });

  it("does not make a channel without options expandable", async () => {
    listChannels.mockResolvedValue({ ok: true, channels: [] });
    await render([target("threads", "me")]);
    expect(document.body.querySelector("[aria-expanded]")).toBeNull();
    expect(text()).toContain("@me");
  });
});
