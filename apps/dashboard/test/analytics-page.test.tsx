/** @vitest-environment jsdom */

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AnalyticsPage from "../app/(app)/projects/[projectId]/analytics/page";
import { INSTALLED_PUBLISHERS, PUBLISHER_PACKAGES_LIST } from "./postiz-installed";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Seam 3: `analytics.listForProject` is simulated.
let rows: unknown[] | undefined = [];
vi.mock("convex/react", () => ({
  useAction: () => async () => ({ entries: [] }),
  useMutation: () => async () => undefined,
  useQuery: (name: unknown) => (name === PUBLISHER_PACKAGES_LIST ? INSTALLED_PUBLISHERS : name === "analytics.listForProject" ? rows : undefined),
}));
vi.mock("@convex/_generated/api", () => ({
  api: {
    analytics: { listForProject: "analytics.listForProject" },
    analytics_connections: { list: "analytics_connections.list" },
    publisher_packages: { list: "publisher_packages.list" },
    hub_packages_node: { catalogue: "hub_packages_node.catalogue", install: "hub_packages_node.install" },
  },
}));
vi.mock("@/src/hooks/use-authenticated-instances", () => ({
  useAuthenticatedInstances: () => [{ openclawId: "inst-1" }],
}));
vi.mock("@/src/hooks/use-resolved-project-id", () => ({ useResolvedProjectId: () => "inst-1" }));
vi.mock("@/src/components/instance-workspace.utils", () => ({
  findInstanceById: (instances: Array<{ openclawId: string }>) => instances[0],
}));
vi.mock("next/link", () => ({ default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }));

const DAY = 24 * 3_600_000;
let n = 0;
function row(overrides: Record<string, unknown> = {}) {
  n += 1;
  return {
    publicationId: `pub-${n}`,
    missionId: `mis-${n}`,
    missionName: `Mission ${n}`,
    missionType: "make_reel",
    target: "instagram:me",
    platform: "instagram",
    channelName: "My IG",
    channelProfile: "me",
    publisherAdapter: "postiz",
    primaryMetric: "views",
    state: "waiting",
    publishedAt: Date.UTC(2026, 10, 15),
    nextAt: Date.UTC(2026, 10, 20),
    snapshots: [],
    ...overrides,
  };
}
const snap = (delayMs: number, metrics: Record<string, number>, postSeries = 0) => ({ postSeries, delayMs, takenAt: delayMs, metrics });

describe("Analytics page", () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    n = 0;
    rows = [];
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
      root.render(<AnalyticsPage params={Promise.resolve({ projectId: "inst-1" })} />);
    });
  }
  const text = () => container.textContent ?? "";
  const listed = () => Array.from(container.querySelectorAll("li[data-publication], button[data-publication]")).map((el) => el.textContent ?? "");
  const detail = () => container.querySelector<HTMLElement>('[aria-label="Selected post"]')?.textContent ?? "";
  const totals = () => container.querySelector<HTMLElement>('section[aria-label="Totals"]')?.textContent ?? "";

  it("says so when no post is measured yet", async () => {
    await render();
    expect(text()).toContain("No measured posts yet");
  });

  it("adds up the posts of every platform in the totals and names the top performing one", async () => {
    rows = [
      row({ missionName: "Small IG", snapshots: [snap(DAY, { views: 100, likes: 10 })] }),
      row({ missionName: "Big TikTok", platform: "tiktok", target: "tiktok:me", snapshots: [snap(DAY, { views: 900, likes: 80, comments: 10 })] }),
    ];
    await render();
    expect(totals()).toContain("2");
    expect(totals()).toContain("1K");
    expect(totals()).toContain("10.0%");
    expect(totals()).toMatch(/Big TikTok/);
    expect(totals()).toContain("Top performing post");
  });

  it("lists the posts best first, with the latest value of each metric, and shows the first one in the detail", async () => {
    rows = [
      row({ title: "Small", snapshots: [snap(DAY, { views: 10 }), snap(3 * DAY, { views: 250, likes: 9, comments: 2 })] }),
      row({ title: "Big", snapshots: [snap(DAY, { views: 900 })] }),
    ];
    await render();
    const items = listed();
    expect(items[0]).toContain("Big");
    expect(items[1]).toContain("Small");
    expect(items[1]).toContain("250");
    expect(detail()).toContain("Big");
  });

  it("shows the post a click selects in the detail, with its trend from the current post only", async () => {
    rows = [
      row({ title: "A", snapshots: [snap(DAY, { views: 900 })] }),
      row({ title: "B", snapshots: [snap(DAY, { views: 9999 }, 0), snap(DAY, { views: 10, likes: 1 }, 1), snap(3 * DAY, { views: 30, likes: 2 }, 1)] }),
    ];
    await render();
    const second = container.querySelectorAll<HTMLButtonElement>("button[data-publication]")[1];
    await act(async () => second.click());
    expect(detail()).toContain("B");
    expect(container.querySelector('svg[role="img"]')?.getAttribute("aria-label")).toBe("Views over time: 10, 30");
  });

  it("filters the posts by the search", async () => {
    rows = [row({ title: "Rituals", snapshots: [snap(DAY, { views: 9 })] }), row({ title: "Diorama", snapshots: [snap(DAY, { views: 5 })] })];
    await render();
    const input = container.querySelector<HTMLInputElement>('input[type="search"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "dior");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(listed()).toHaveLength(1);
    expect(listed()[0]).toContain("Diorama");
  });

  it("shows when the next reading is due, and 'No data yet' before the first one", async () => {
    rows = [row({ title: "Fresh", state: "waiting" })];
    await render();
    expect(listed()[0]).toContain("No data yet");
    expect(detail()).toContain("Next reading");
    expect(detail()).toContain(new Date(Date.UTC(2026, 10, 20)).toLocaleDateString());
  });

  it("shows why a reading failed, and that it will be tried again", async () => {
    rows = [row({ state: "failed", reason: "Service answered 500" })];
    await render();
    expect(detail()).toContain("Failed");
    expect(detail()).toContain("Service answered 500");
    expect(detail()).toContain("Next reading");
  });

  it("shows an unknown post with its reason, keeping the history and no next reading", async () => {
    rows = [row({ state: "post_unknown", reason: "Post not found at the service", nextAt: undefined, snapshots: [snap(DAY, { views: 42 })] })];
    await render();
    expect(detail()).toContain("Post unknown");
    expect(detail()).toContain("Post not found at the service");
    expect(detail()).toContain("42");
    expect(detail()).not.toContain("Next reading");
  });
});
