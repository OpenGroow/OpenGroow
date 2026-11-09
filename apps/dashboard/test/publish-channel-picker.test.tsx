/** @vitest-environment jsdom */

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PublishChannelPicker } from "../src/components/publish-channel-picker";
import { INSTALLED_PUBLISHERS, PUBLISHER_PACKAGES_LIST } from "./postiz-installed";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
// jsdom has no PointerEvent, which the Switch primitive dispatches on click.
globalThis.PointerEvent ??= MouseEvent as typeof PointerEvent;

// The list items are Combobox primitives: their state is in ARIA/data attributes, not in .disabled.
const isDisabled = (el: Element) => el.hasAttribute("data-disabled") || el.getAttribute("aria-disabled") === "true";

const useQueryMock = vi.fn();

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={href} {...props}>{children}</a>
  ),
}));
const listChannelsMock = vi.fn();
const setChannelProfileMock = vi.fn();
vi.mock("convex/react", () => ({
  useQuery: (...args: unknown[]) => (args[0] === PUBLISHER_PACKAGES_LIST ? INSTALLED_PUBLISHERS : useQueryMock(...args)),
  useAction: () => listChannelsMock,
  useMutation: () => setChannelProfileMock,
}));
vi.mock("@convex/_generated/api", () => ({
  api: { publishers: { get: "publishers.get", setChannelProfiles: "publishers.setChannelProfiles" }, publishers_node: { listChannels: "publishers_node.listChannels" }, publisher_packages: { list: "publisher_packages.list" } },
}));

const PUBLISHER = {
  adapter: "postiz",
  url: "https://postiz.example.com",
  hasApiKey: true,
  targets: [
    { target: "instagram:myinsta", mapped: true, channelId: "c1", channelName: "My IG", channelService: "instagram", channelProfile: "myinsta" },
    { target: "pinterest:pins", mapped: true, channelId: "c2", channelName: "Pins", channelService: "pinterest", channelProfile: "pins" },
  ],
};

describe("PublishChannelPicker", () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    useQueryMock.mockReset();
    listChannelsMock.mockReset();
    setChannelProfileMock.mockReset();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  async function render(payloadText: string, onChange = vi.fn(), kind?: string, platforms?: string[]) {
    await act(async () => {
      root.render(<PublishChannelPicker instanceId="inst-1" payloadText={payloadText} kind={kind} platforms={platforms} onChange={onChange} />);
    });
    return onChange;
  }

  const openList = async () => {
    await act(async () => {
      (container.querySelector('[aria-label="Show channels"]') as HTMLElement).click();
    });
  };
  const item = (target: string) => document.querySelector(`[data-testid="publish-target-${target}"]`) as HTMLElement | null;

  it("writes the chosen channels into the payload and keeps its other fields", async () => {
    useQueryMock.mockReturnValue(PUBLISHER);
    const onChange = await render('{"topic":"x"}');
    await openList();
    expect(document.body.textContent).toContain("@myinsta");
    await act(async () => item("pinterest:pins")!.click());
    expect(JSON.parse(onChange.mock.calls[0][0] as string)).toEqual({ topic: "x", publishTargets: ["pinterest:pins"] });
  });

  it("shows the channels of the payload as chips, and removing the last one removes the key", async () => {
    useQueryMock.mockReturnValue(PUBLISHER);
    const onChange = await render('{"publishTargets":["instagram:myinsta"]}');
    const chip = container.querySelector('[data-testid="publish-chip-instagram:myinsta"]') as HTMLElement;
    expect(chip.textContent).toContain("@myinsta");
    expect(container.querySelector('[data-testid="publish-chip-pinterest:pins"]')).toBeNull();
    await act(async () => (chip.querySelector('[data-slot="combobox-chip-remove"]') as HTMLElement).click());
    expect(onChange).toHaveBeenCalledWith("");
  });

  it("disables channels that cannot carry the kind (with the reason) and warns on uncertain ones", async () => {
    useQueryMock.mockReturnValue({
      ...PUBLISHER,
      targets: [
        ...PUBLISHER.targets,
        { target: "youtube:yt", mapped: true, channelId: "c3", channelName: "YT", channelService: "youtube", channelProfile: "yt" },
      ],
    });
    await render("", vi.fn(), "image");
    await openList();
    expect(isDisabled(item("youtube:yt")!)).toBe(true);
    expect(document.body.textContent).toContain("YouTube cannot publish an image");
    expect(isDisabled(item("instagram:myinsta")!)).toBe(false);
  });

  it("disables the channels on a platform the Mission type does not publish to, naming the ones it does", async () => {
    useQueryMock.mockReturnValue(PUBLISHER);
    await render("", vi.fn(), "carousel", ["instagram", "tiktok"]);
    await openList();
    expect(isDisabled(item("pinterest:pins")!)).toBe(true);
    expect(document.body.textContent).toContain("This Mission type publishes to Instagram and TikTok only");
    expect(isDisabled(item("instagram:myinsta")!)).toBe(false);
  });

  it("says so when the Publisher has no channel on a platform the Mission type publishes to", async () => {
    useQueryMock.mockReturnValue(PUBLISHER);
    await render("", vi.fn(), "carousel", ["instagram", "tiktok"]);
    expect(document.querySelector('[data-testid="publish-missing-platforms"]')?.textContent).toContain("TikTok");
    await render("", vi.fn(), "carousel", ["instagram", "pinterest"]);
    expect(document.querySelector('[data-testid="publish-missing-platforms"]')).toBeNull();
  });

  it("warns on a channel whose support for the kind is not confirmed", async () => {
    useQueryMock.mockReturnValue(PUBLISHER);
    await render("", vi.fn(), "video");
    await openList();
    expect(document.querySelector('[data-testid="publish-target-warning-pinterest:pins"]')).not.toBeNull();
    expect(isDisabled(item("pinterest:pins")!)).toBe(false);
  });

  it("shows why on hover of the warning triangle only, in a tooltip rendered in <body> (above a modal)", async () => {
    useQueryMock.mockReturnValue(PUBLISHER);
    await render("", vi.fn(), "video");
    await openList();
    const warning = document.querySelector('[data-testid="publish-target-warning-pinterest:pins"]') as HTMLElement;
    expect(warning.getAttribute("aria-label")).toContain("A Pinterest video pin needs a cover image");
    const tooltip = () => document.querySelector('[data-slot="tooltip-content"]');
    // Hovering the row (not the triangle) shows nothing.
    await act(async () => {
      for (const type of ["pointerover", "pointerenter", "mouseover", "mouseenter", "pointermove", "mousemove"]) {
        item("pinterest:pins")!.dispatchEvent(new MouseEvent(type, { bubbles: true }));
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    });
    expect(tooltip()).toBeNull();
    // Hovering the triangle does.
    await act(async () => {
      for (const type of ["pointerover", "pointerenter", "mouseover", "mouseenter", "pointermove", "mousemove"]) {
        warning.dispatchEvent(new MouseEvent(type, { bubbles: true }));
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    });
    expect(tooltip()?.textContent).toContain("Not confirmed: A Pinterest video pin needs a cover image");
    // Not nested in the dropdown's (or a modal's) portal: a direct child portal of <body>, above everything.
    expect(tooltip()!.closest("[data-base-ui-portal]")?.parentElement).toBe(document.body);
    expect((tooltip()!.closest("[data-slot]") as HTMLElement | null) !== null).toBe(true);
    expect((tooltip()!.parentElement as HTMLElement).style.zIndex).toBe("1000");
  });

  it("shows the account @handle, not the Postiz channel name, falling back to the key's handle without a profile", async () => {
    useQueryMock.mockReturnValue({
      ...PUBLISHER,
      targets: [
        { target: "instagram:myinsta", mapped: true, channelId: "c1", channelName: "Love You Make", channelService: "instagram", channelProfile: "myinsta" },
        { target: "tiktok:loveyoumake", mapped: true, channelId: "c2", channelName: "Loveyoumake Display", channelService: "tiktok" },
      ],
    });
    await render("");
    await openList();
    expect(item("instagram:myinsta")?.textContent).toContain("@myinsta");
    expect(item("tiktok:loveyoumake")?.textContent).toContain("@loveyoumake");
    expect(document.body.textContent).not.toContain("Love You Make");
    expect(document.body.textContent).not.toContain("Display");
  });

  it("never invents a handle from a bare legacy key: it shows the channel name until a profile is stored", async () => {
    useQueryMock.mockReturnValue({
      ...PUBLISHER,
      targets: [
        { target: "instagram", mapped: true, channelId: "c1", channelName: "Love You Make", channelService: "instagram" },
        { target: "tiktok", mapped: true, channelId: "c2", channelName: "Loveyoumake", channelService: "tiktok", channelProfile: "loveyoumake4" },
      ],
    });
    await render("");
    await openList();
    expect(item("instagram")?.textContent).toContain("Love You Make");
    expect(item("instagram")?.textContent).not.toContain("@");
    expect(item("tiktok")?.textContent).toContain("@loveyoumake4");
  });

  it("stores the live handle of a channel that has none, once, without the Publishers page", async () => {
    useQueryMock.mockReturnValue({
      ...PUBLISHER,
      targets: [
        { target: "instagram", mapped: true, channelId: "c1", channelName: "Love You Make", channelService: "instagram" },
        PUBLISHER.targets[1],
      ],
    });
    listChannelsMock.mockResolvedValue({ ok: true, channels: [{ id: "c1", name: "Love You Make", service: "instagram", profile: "love_youmake" }] });
    await render("");
    await act(async () => {});
    expect(listChannelsMock).toHaveBeenCalledTimes(1);
    expect(setChannelProfileMock).toHaveBeenCalledTimes(1);
    expect(setChannelProfileMock).toHaveBeenCalledWith({
      instanceId: "inst-1",
      profiles: [{ target: "instagram", channelProfile: "love_youmake" }],
    });
  });

  it("asks Postiz for nothing when every channel already has its handle", async () => {
    useQueryMock.mockReturnValue(PUBLISHER);
    await render("");
    expect(listChannelsMock).not.toHaveBeenCalled();
  });

  it("links to the Publishers page when the Project has no channel", async () => {
    useQueryMock.mockReturnValue(null);
    await render("");
    expect(container.querySelector("a")?.getAttribute("href")).toBe("/projects/inst-1/publishers");
  });

  describe("Auto-publish in the same card", () => {
    async function renderWithAuto(onAuto: (next: boolean) => void, checked = false) {
      await act(async () => {
        root.render(
          <PublishChannelPicker
            instanceId="inst-1"
            payloadText=""
            onChange={vi.fn()}
            autoPublish={{ checked, onChange: onAuto }}
          />,
        );
      });
    }

    it("shows the toggle next to the date, inside the Publish card", async () => {
      useQueryMock.mockReturnValue(PUBLISHER);
      await renderWithAuto(vi.fn());
      const options = container.querySelector('[data-testid="publish-options"]');
      expect(options?.textContent).toContain("Auto-publish");
      expect(options?.querySelector('[data-testid="publish-at"]')).not.toBeNull();
      expect(container.querySelector('[data-testid="publish-channel-picker"]')?.contains(options as Node)).toBe(true);
    });

    it("still offers Auto-publish and the date when the Project has no channel", async () => {
      useQueryMock.mockReturnValue(null);
      await renderWithAuto(vi.fn());
      expect(container.textContent).toContain("No channel yet");
      expect(container.querySelector('[data-testid="publish-options"]')?.textContent).toContain("Auto-publish");
    });

    it("reports the toggle", async () => {
      useQueryMock.mockReturnValue(PUBLISHER);
      const onAuto = vi.fn();
      await renderWithAuto(onAuto);
      await act(async () => {
        (container.querySelector('[role="switch"]') as HTMLElement).click();
      });
      expect(onAuto).toHaveBeenCalledWith(true);
    });

    it("renders no toggle when none is given", async () => {
      useQueryMock.mockReturnValue(PUBLISHER);
      await render("");
      expect(container.querySelector('[role="switch"]')).toBeNull();
    });
  });

  it("lists the channels of the Publisher in the dropdown, adds the clicked one, and closes on Done", async () => {
    useQueryMock.mockReturnValue(PUBLISHER);
    const onChange = await render('{"publishTargets":["instagram:myinsta"]}');
    await openList();
    expect(item("pinterest:pins")).not.toBeNull();
    await act(async () => item("pinterest:pins")!.click());
    expect(JSON.parse(onChange.mock.calls.at(-1)![0] as string)).toEqual({
      publishTargets: ["instagram:myinsta", "pinterest:pins"],
    });
    const done = Array.from(document.querySelectorAll("button")).find((b) => b.textContent === "Done")!;
    await act(async () => done.click());
    expect(item("pinterest:pins")).toBeNull();
  });

  it("has no checkbox rows: the channels are chips and a dropdown", async () => {
    useQueryMock.mockReturnValue(PUBLISHER);
    await render("");
    expect(container.querySelector('[role="checkbox"]')).toBeNull();
    expect(container.querySelector('[data-testid="publish-channel-select"]')).not.toBeNull();
  });
});
