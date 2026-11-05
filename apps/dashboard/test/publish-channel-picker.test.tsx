/** @vitest-environment jsdom */

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PublishChannelPicker } from "../src/components/publish-channel-picker";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const useQueryMock = vi.fn();

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={href} {...props}>{children}</a>
  ),
}));
vi.mock("convex/react", () => ({ useQuery: (...args: unknown[]) => useQueryMock(...args) }));
vi.mock("@convex/_generated/api", () => ({ api: { publishers: { get: "publishers.get" } } }));

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
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  async function render(payloadText: string, onChange = vi.fn(), kind?: string) {
    await act(async () => {
      root.render(<PublishChannelPicker instanceId="inst-1" payloadText={payloadText} kind={kind} onChange={onChange} />);
    });
    return onChange;
  }

  it("writes the chosen channels into the payload and keeps its other fields", async () => {
    useQueryMock.mockReturnValue(PUBLISHER);
    const onChange = await render('{"topic":"x"}');
    expect(container.textContent).toContain("@myinsta");
    await act(async () => {
      (container.querySelector('[data-testid="publish-target-pinterest:pins"]') as HTMLInputElement).click();
    });
    expect(JSON.parse(onChange.mock.calls[0][0] as string)).toEqual({ topic: "x", publishTargets: ["pinterest:pins"] });
  });

  it("pre-checks the channels of the payload and unchecking the last one removes the key", async () => {
    useQueryMock.mockReturnValue(PUBLISHER);
    const onChange = await render('{"publishTargets":["instagram:myinsta"]}');
    const box = container.querySelector('[data-testid="publish-target-instagram:myinsta"]') as HTMLInputElement;
    expect(box.checked).toBe(true);
    await act(async () => box.click());
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
    expect((container.querySelector('[data-testid="publish-target-youtube:yt"]') as HTMLInputElement).disabled).toBe(true);
    expect(container.textContent).toContain("YouTube cannot publish an image");
    expect((container.querySelector('[data-testid="publish-target-instagram:myinsta"]') as HTMLInputElement).disabled).toBe(false);
    await render("", vi.fn(), "video");
    expect(container.querySelector('[data-testid="publish-target-warning-pinterest:pins"]')).not.toBeNull();
    expect((container.querySelector('[data-testid="publish-target-pinterest:pins"]') as HTMLInputElement).disabled).toBe(false);
  });

  it("links to the Publishers page when the Project has no channel", async () => {
    useQueryMock.mockReturnValue(null);
    await render("");
    expect(container.querySelector("a")?.getAttribute("href")).toBe("/projects/inst-1/publishers");
  });
});
