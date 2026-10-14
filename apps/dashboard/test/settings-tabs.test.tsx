/** @vitest-environment jsdom */

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsTabs } from "../src/components/settings-tabs";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let pathname = "/projects/project-1/settings/providers";
vi.mock("next/navigation", () => ({ usePathname: () => pathname }));
vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

describe("SettingsTabs", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    // Every test starts from the same known route: the mocked pathname is
    // module state that a previous test may have changed.
    pathname = "/projects/project-1/settings/providers";
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => root.render(<SettingsTabs projectId="project-1" />));
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it("links the seven settings pages under /settings, Overview first", () => {
    const links = Array.from(container.querySelectorAll("nav a"));
    expect(links.map((a) => [a.textContent?.trim(), a.getAttribute("href")])).toEqual([
      ["Overview", "/projects/project-1/settings/overview"],
      ["Channels", "/projects/project-1/settings/channels"],
      ["Providers", "/projects/project-1/settings/providers"],
      ["Devices", "/projects/project-1/settings/devices"],
      ["Workspaces", "/projects/project-1/settings/workspaces"],
      ["Security", "/projects/project-1/settings/security"],
      ["Usage", "/projects/project-1/settings/usage"],
    ]);
  });

  it("marks the tab whose page is the current route", () => {
    const current = container.querySelectorAll("[aria-current='page']");
    expect(current).toHaveLength(1);
    expect(current[0].textContent?.trim()).toBe("Providers");
  });

  it("marks the current page's tab, including a nested route", async () => {
    pathname = "/projects/project-1/settings/workspaces/ws-1";
    await act(async () => root.render(<SettingsTabs projectId="project-1" />));
    const current = container.querySelectorAll("[aria-current='page']");
    expect(current).toHaveLength(1);
    expect(current[0].textContent?.trim()).toBe("Workspaces");
  });
});
