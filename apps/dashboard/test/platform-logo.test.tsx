/** @vitest-environment jsdom */

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PlatformLogo } from "@/src/components/platform-logo";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const TIKTOK_ICON = "data:image/png;base64,VElLVE9L";
const POSTIZ_ICON = "data:image/png;base64,UE9TVEla";
const GITHUB_ICON = "data:image/svg+xml;base64,PHN2Zy8+";
vi.mock("convex/react", () => ({
  useQuery: () => [
    { adapter: "postiz", name: "Postiz", icon: POSTIZ_ICON, capabilities: { schemaVersion: 1, adapter: "postiz", platforms: { tiktok: { name: "TikTok", icon: TIKTOK_ICON }, pinterest: { name: "Pinterest" } } } },
    { adapter: "github", name: "GitHub", icon: GITHUB_ICON, capabilities: { schemaVersion: 1, adapter: "github", platforms: { github: { name: "GitHub" } } } },
  ],
}));
vi.mock("@convex/_generated/api", () => ({ api: { publisher_packages: { list: "publisher_packages.list" } } }));

describe("PlatformLogo (ADR-075)", () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });
  const src = () => container.querySelector("img")?.getAttribute("src");

  it("shows the platform logo the package ships, with no request", async () => {
    await act(async () => root.render(<PlatformLogo service="tiktok" adapter="postiz" />));
    expect(src()).toBe(TIKTOK_ICON);
  });

  it("falls back to the package icon when the package ships none for the platform (GitHub, a single platform)", async () => {
    await act(async () => root.render(<PlatformLogo service="github" adapter="github" />));
    expect(src()).toBe(GITHUB_ICON);
    await act(async () => root.render(<PlatformLogo service="pinterest" adapter="postiz" />));
    expect(src()).toBe(POSTIZ_ICON);
  });

  it("shows an empty tile without a platform, or when the image does not load", async () => {
    await act(async () => root.render(<PlatformLogo adapter="postiz" />));
    expect(container.querySelector("img")).toBeNull();
    await act(async () => root.render(<PlatformLogo service="tiktok" adapter="postiz" />));
    await act(async () => container.querySelector("img")!.dispatchEvent(new Event("error")));
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("span.bg-muted")).not.toBeNull();
  });
});
