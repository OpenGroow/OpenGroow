/** @vitest-environment jsdom */

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PlatformLogo } from "@/src/components/platform-logo";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const GITHUB_ICON = "data:image/svg+xml;base64,PHN2Zy8+";
vi.mock("convex/react", () => ({ useQuery: () => [{ adapter: "github", name: "GitHub", icon: GITHUB_ICON }] }));
vi.mock("@convex/_generated/api", () => ({ api: { publisher_packages: { list: "publisher_packages.list" } } }));

describe("PlatformLogo", () => {
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

  it("asks the Publisher for the platform logo, as Postiz serves them", async () => {
    await act(async () => root.render(<PlatformLogo baseUrl="https://postiz.example.com/" service="instagram" adapter="postiz" />));
    expect(container.querySelector("img")?.getAttribute("src")).toBe("https://postiz.example.com/icons/platforms/instagram.png");
  });

  it("falls back to the Publisher package's icon when the Publisher serves no platform logo (GitHub)", async () => {
    await act(async () => root.render(<PlatformLogo baseUrl="https://api.github.com" service="github" adapter="github" />));
    await act(async () => container.querySelector("img")!.dispatchEvent(new Event("error")));
    expect(container.querySelector("img")?.getAttribute("src")).toBe(GITHUB_ICON);
  });

  it("shows an empty tile when there is neither", async () => {
    await act(async () => root.render(<PlatformLogo baseUrl="https://p.example.com" service="mastodon" adapter="postiz" />));
    await act(async () => container.querySelector("img")!.dispatchEvent(new Event("error")));
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("span.bg-muted")).not.toBeNull();
  });
});
