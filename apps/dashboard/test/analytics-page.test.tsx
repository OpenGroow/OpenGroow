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
  useQuery: (name: unknown) => (name === PUBLISHER_PACKAGES_LIST ? INSTALLED_PUBLISHERS : name === "analytics.listForProject" ? rows : undefined),
}));
vi.mock("@convex/_generated/api", () => ({
  api: { analytics: { listForProject: "analytics.listForProject" }, publisher_packages: { list: "publisher_packages.list" } },
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
  const section = (platform: string) => container.querySelector<HTMLElement>(`section[aria-label="${platform}"]`)!;
  const listed = (el: HTMLElement) => Array.from(el.querySelectorAll("li[data-publication]")).map((li) => li.textContent ?? "");

  it("says so when no Publication has been published yet", async () => {
    await render();
    expect(text()).toContain("No published posts yet");
  });

  it("lists a Publication with its platform, channel, Mission, Source of origin and the latest value of each metric", async () => {
    rows = [
      row({
        missionName: "Spring reel",
        source: { id: "s1", label: "Competitor reel", origin: "https://example.com/r" },
        snapshots: [snap(DAY, { views: 100, likes: 3 }), snap(3 * DAY, { views: 250, likes: 9 })],
      }),
    ];
    await render();
    const card = section("Instagram");
    expect(card.textContent).toContain("@me");
    expect(card.textContent).toContain("Spring reel");
    expect(card.textContent).toContain("Competitor reel");
    expect(card.textContent).toMatch(/views\s*250/i);
    expect(card.textContent).toMatch(/likes\s*9/i);
    expect(card.textContent).not.toMatch(/views\s*100/i);
  });

  it("ranks by the primary metric within one platform only, with no total across platforms or Missions", async () => {
    rows = [
      row({ missionName: "Small IG", snapshots: [snap(DAY, { views: 10 })] }),
      row({ missionName: "Big IG", snapshots: [snap(DAY, { views: 900 })] }),
      row({ missionName: "Huge TikTok", platform: "tiktok", target: "tiktok:me", snapshots: [snap(DAY, { views: 99999 })] }),
    ];
    await render();
    const ig = listed(section("Instagram"));
    expect(ig[0]).toContain("Big IG");
    expect(ig[0]).toContain("#1");
    expect(ig[1]).toContain("Small IG");
    expect(ig[1]).toContain("#2");
    const tt = listed(section("TikTok"));
    expect(tt).toHaveLength(1);
    expect(tt[0]).toContain("#1");
    expect(text()).not.toMatch(/total/i);
  });

  it("does not rank a Publication without a reading, and keeps it after the ranked ones", async () => {
    rows = [row({ missionName: "Waiting" }), row({ missionName: "Measured", snapshots: [snap(DAY, { views: 5 })] })];
    await render();
    const ig = listed(section("Instagram"));
    expect(ig[0]).toContain("Measured");
    expect(ig[1]).toContain("Waiting");
    expect(ig[1]).not.toContain("#");
  });

  it("draws a curve per metric from the Snapshots of the current post", async () => {
    rows = [
      row({
        snapshots: [snap(DAY, { views: 9999 }, 0), snap(DAY, { views: 10, likes: 1 }, 1), snap(3 * DAY, { views: 30, likes: 2 }, 1)],
      }),
    ];
    await render();
    const curves = Array.from(container.querySelectorAll('svg[role="img"]'));
    expect(curves.map((c) => c.getAttribute("aria-label"))).toEqual(["views over time: 10, 30", "likes over time: 1, 2"]);
    expect(text()).toMatch(/views\s*30/i);
  });

  it("shows when the next reading is due, and 'No data yet' before the first one", async () => {
    rows = [row({ state: "waiting" }), row({ state: "no_data", snapshots: [] })];
    await render();
    expect(text()).toContain("No data yet");
    expect(text()).toContain("Next reading");
    expect(text()).toContain(new Date(Date.UTC(2026, 10, 20)).toLocaleDateString());
  });

  it("says 'Analytics unavailable' for a channel that is not measured", async () => {
    rows = [row({ state: "unmeasured", nextAt: undefined, primaryMetric: undefined })];
    await render();
    expect(text()).toContain("Analytics unavailable");
    expect(text()).not.toContain("No data yet");
    expect(text()).not.toContain("Next reading");
  });

  it("shows why a reading failed, and that it will be tried again", async () => {
    rows = [row({ state: "failed", reason: "Service answered 500" })];
    await render();
    expect(text()).toContain("Failed");
    expect(text()).toContain("Service answered 500");
    expect(text()).toContain("Next reading");
  });

  it("shows an unknown post with its reason, keeping the history and no next reading", async () => {
    rows = [row({ state: "post_unknown", reason: "Post not found at the service", nextAt: undefined, snapshots: [snap(DAY, { views: 42 })] })];
    await render();
    expect(text()).toContain("Post unknown");
    expect(text()).toContain("Post not found at the service");
    expect(text()).toMatch(/views\s*42/i);
    expect(text()).not.toContain("Next reading");
  });
});
