/** @vitest-environment jsdom */

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AnalyticsPage from "../app/(app)/projects/[projectId]/analytics/page";
import { INSTALLED_PUBLISHERS, PUBLISHER_PACKAGES_LIST } from "./postiz-installed";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Seam 3: `analytics.listForProject` is simulated.
const refreshAction = vi.fn(async (..._args: unknown[]) => ({ read: 2, unavailable: 0, failed: 0 }));
let rows: unknown[] | undefined = [];
let declaration: unknown = null;
vi.mock("convex/react", () => ({
  useAction: () => refreshAction,
  useMutation: () => async () => undefined,
  useQuery: (name: unknown) => (name === PUBLISHER_PACKAGES_LIST ? INSTALLED_PUBLISHERS : name === "analytics.listForProject" ? rows : name === "analytics.declarationForProject" ? declaration : undefined),
}));
vi.mock("@convex/_generated/api", () => ({
  api: {
    analytics: { listForProject: "analytics.listForProject", declarationForProject: "analytics.declarationForProject" },
    analytics_node: { refresh: "analytics_node.refresh" },
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
    declaration = null;
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

  const SEARCH_CONSOLE = {
    primary: "clicks",
    metrics: [
      { key: "clicks", label: "Clicks", type: "counter", format: "number" },
      { key: "position", label: "Position", type: "level", format: "number", better: "lower" },
    ],
  };

  it("shows a counter's total with its variation since the previous Snapshot", async () => {
    declaration = SEARCH_CONSOLE;
    rows = [row({ title: "Post", snapshots: [snap(3 * DAY, { clicks: 12 }), snap(7 * DAY, { clicks: 46 })] })];
    await render();
    expect(listed()[0]).toContain("46");
    expect(listed()[0]).toContain("+34");
    expect(detail()).toContain("+34");
  });

  it("shows no variation under a counter with a single Snapshot", async () => {
    declaration = SEARCH_CONSOLE;
    rows = [row({ title: "Post", snapshots: [snap(3 * DAY, { clicks: 12 })] })];
    await render();
    expect(listed()[0]).toContain("12");
    expect(listed()[0]).not.toMatch(/[+\u2212-]\d/);
    expect(detail()).not.toMatch(/[+\u2212]\d/);
  });

  it("compares only the Snapshots of the post's current series", async () => {
    declaration = SEARCH_CONSOLE;
    rows = [row({ title: "Post", snapshots: [snap(3 * DAY, { clicks: 500 }, 0), snap(7 * DAY, { clicks: 20 }, 1)] })];
    await render();
    expect(listed()[0]).toContain("20");
    expect(listed()[0]).not.toMatch(/[+\u2212-]\d/);
  });

  it("points an improving arrow when a level where lower is better goes down", async () => {
    declaration = SEARCH_CONSOLE;
    rows = [
      row({ title: "Better", snapshots: [snap(3 * DAY, { clicks: 1, position: 14.2 }), snap(7 * DAY, { clicks: 2, position: 11.8 })] }),
      row({ title: "Worse", snapshots: [snap(3 * DAY, { clicks: 1, position: 11.8 }), snap(7 * DAY, { clicks: 1, position: 14.2 })] }),
    ];
    await render();
    const better = container.querySelector('button[data-publication="pub-1"]')!;
    const worse = container.querySelector('button[data-publication="pub-2"]')!;
    expect(better.querySelector('[data-trend="improving"]')).not.toBeNull();
    expect(better.querySelector('[data-trend="improving"]')?.getAttribute("aria-label")).toBe("Improving");
    expect(worse.querySelector('[data-trend="worsening"]')).not.toBeNull();
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

  it("reads every post again on Refresh and says how many were updated", async () => {
    rows = [row({ title: "A", snapshots: [snap(DAY, { views: 9 })] })];
    refreshAction.mockClear();
    await render();
    const button = Array.from(container.querySelectorAll("button")).find((b) => b.textContent?.includes("Refresh"))!;
    await act(async () => button.click());
    expect(refreshAction).toHaveBeenCalledWith({ instanceId: "inst-1" });
    expect(text()).toContain("2 posts updated");
  });

  it("says why a refresh could not read a post", async () => {
    rows = [row({ title: "A", snapshots: [snap(DAY, { views: 9 })] })];
    refreshAction.mockResolvedValueOnce({ read: 0, unavailable: 0, failed: 1, error: "Service answered 500" } as never);
    await render();
    const button = Array.from(container.querySelectorAll("button")).find((b) => b.textContent?.includes("Refresh"))!;
    await act(async () => button.click());
    expect(text()).toContain("1 post could not be read: Service answered 500");
  });

  it("shows the first frame of a video that has no cover", async () => {
    rows = [row({ title: "Clip", kind: "video", videoUrl: "https://cdn.example.com/v.mp4", snapshots: [snap(DAY, { views: 9 })] })];
    await render();
    expect(container.querySelector("li button video, button[data-publication] video")?.getAttribute("src")).toBe("https://cdn.example.com/v.mp4#t=0.1");
  });

  describe("with the declaration of the adapter (ADR-079)", () => {
    const counter = (key: string, label: string) => ({ key, label, type: "counter", format: "number" });
    const SEARCH = {
      adapter: "search",
      name: "Search",
      primary: "clicks",
      metrics: [
        counter("clicks", "Clicks"),
        counter("impressions", "Impressions"),
        { key: "ctr", label: "CTR", type: "level", format: "percent", derive: { sum: ["clicks"], per: "impressions" } },
        { key: "position", label: "Position", type: "level", format: "number", better: "lower" },
        counter("sessions", "Sessions"),
      ],
    };
    const headers = () => Array.from(container.querySelectorAll('[data-slot="columns-header"] > span')).map((el) => el.textContent);
    const columnsButton = () => Array.from(container.querySelectorAll("button")).find((b) => b.textContent?.trim() === "Columns")!;

    it("shows the first four declared metrics as columns and offers the others in a Columns menu", async () => {
      declaration = SEARCH;
      rows = [row({ title: "Page", primaryMetric: undefined, snapshots: [snap(DAY, { clicks: 40, impressions: 800, position: 3, sessions: 7 })] })];
      await render();
      expect(headers()).toEqual(expect.arrayContaining(["Clicks", "Impressions", "CTR", "Position"]));
      expect(headers()).not.toContain("Sessions");
      expect(listed()[0]).toContain("5.0%");
      expect(listed()[0]).not.toContain("7");
      await act(async () => columnsButton().click());
      const sessions = Array.from(container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')).find((c) => c.closest("label")?.textContent?.includes("Sessions"))!;
      expect(Array.from(container.querySelectorAll('input[type="checkbox"]'))).toHaveLength(1);
      await act(async () => sessions.click());
      expect(headers()).toContain("Sessions");
      expect(listed()[0]).toContain("7");
    });

    it("computes a derived figure for the totals from the summed counters, never the mean of rates", async () => {
      declaration = SEARCH;
      rows = [
        row({ title: "Small", snapshots: [snap(DAY, { clicks: 50, impressions: 100 })] }),
        row({ title: "Big", snapshots: [snap(DAY, { clicks: 0, impressions: 900 })] }),
      ];
      await render();
      expect(totals()).toContain("5.0%");
      expect(totals()).not.toContain("25.0%");
      expect(totals()).toContain("50Total clicks");
    });

    it("ranks the posts and picks the top post by the adapter's main metric, lowest first when lower is better", async () => {
      declaration = { ...SEARCH, primary: "position" };
      rows = [
        row({ title: "Deep", snapshots: [snap(DAY, { position: 30, clicks: 900 })] }),
        row({ title: "Near top", snapshots: [snap(DAY, { position: 2, clicks: 1 })] }),
      ];
      await render();
      expect(listed()[0]).toContain("Near top");
      expect(totals()).toMatch(/Near top/);
    });

    it("shows a dash for a metric with no value, and nothing for a metric no longer declared", async () => {
      declaration = SEARCH;
      rows = [row({ title: "Page", snapshots: [snap(DAY, { clicks: 40, views: 999 })] })];
      await render();
      expect(listed()[0]).toContain("—");
      expect(listed()[0]).not.toContain("999");
      expect(detail()).not.toContain("999");
      expect(detail()).not.toContain("Views");
    });
  });
});
