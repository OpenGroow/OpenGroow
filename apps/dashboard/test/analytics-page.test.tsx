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
// `rows` may depend on the adapter the page asks for; `adapters` is what `analytics.adaptersForProject` answers.
let rows: unknown[] | undefined | ((args: { adapter?: string }) => unknown[]) = [];
let adapters: unknown[] = [];
let unavailable: unknown[] = [];
let emptyReason: unknown = { reason: "none" };
// What a social adapter declares (Postiz): the page shows exactly what the adapter declares.
const SOCIAL_ADAPTER = {
  adapter: "postiz",
  name: "Postiz",
  primary: "views",
  metrics: [
    { key: "views", label: "Views", type: "counter", format: "number" },
    { key: "likes", label: "Likes", type: "counter", format: "number" },
    { key: "comments", label: "Comments", type: "counter", format: "number" },
    { key: "engagement", label: "Engagement", type: "level", format: "percent", derive: { sum: ["likes", "comments", "shares", "saves"], per: "views" } },
    { key: "reach", label: "Reach", type: "counter", format: "number" },
    { key: "shares", label: "Shares", type: "counter", format: "number" },
    { key: "saves", label: "Saves", type: "counter", format: "number" },
  ],
};
const listArgs: Array<{ adapter?: string; recipeId?: string; familyId?: string; from?: number }> = [];
// What `analytics_summary.summaryForProject` answers for each grouping.
let recipeSummary: unknown = { groupBy: "recipe", recipes: [], unattributed: 0, partial: false };
let familySummary: unknown = { groupBy: "family", families: [], unattributed: 0, partial: false };
const summaryArgs: Array<Record<string, unknown>> = [];
vi.mock("convex/react", () => ({
  useAction: () => refreshAction,
  useMutation: () => async () => undefined,
  useQuery: (name: unknown, args?: { adapter?: string; groupBy?: string }) => {
    if (name === PUBLISHER_PACKAGES_LIST) return INSTALLED_PUBLISHERS;
    if (name === "analytics.adaptersForProject") return adapters;
    if (name === "analytics.unavailableForProject") return unavailable;
    if (name === "analytics.emptyReason") return emptyReason;
    if (name === "analytics_summary.summaryForProject") {
      if ((args as unknown) === "skip") return undefined;
      summaryArgs.push(args as Record<string, unknown>);
      return (args as { groupBy?: string }).groupBy === "family" ? familySummary : recipeSummary;
    }
    if (name === "analytics.listForProject") {
      if (args === undefined || (args as unknown) === "skip") return undefined;
      listArgs.push(args);
      return typeof rows === "function" ? rows(args) : rows;
    }
    return undefined;
  },
}));
vi.mock("@convex/_generated/api", () => ({
  api: {
    analytics: { listForProject: "analytics.listForProject", adaptersForProject: "analytics.adaptersForProject", unavailableForProject: "analytics.unavailableForProject", emptyReason: "analytics.emptyReason" },
    analytics_summary: { summaryForProject: "analytics_summary.summaryForProject" },
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
    adapters = [SOCIAL_ADAPTER];
    unavailable = [];
    emptyReason = { reason: "none" };
    listArgs.length = 0;
    summaryArgs.length = 0;
    recipeSummary = { groupBy: "recipe", recipes: [], unattributed: 0, partial: false };
    familySummary = { groupBy: "family", families: [], unattributed: 0, partial: false };
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

  it("lists the posts whose channel has no analytics adapter as unavailable, not as waiting for data", async () => {
    unavailable = [{ publicationId: "pub-x", missionName: "Unlinked reel", platform: "instagram", channelName: "My IG", publishedAt: Date.UTC(2026, 10, 15), reason: "No Analytics Adapter is linked to this channel" }];
    await render();
    expect(text()).toContain("Analytics unavailable");
    expect(text()).toContain("Unlinked reel");
    expect(text()).not.toContain("No measured posts yet");
  });

  it("says nothing about unavailable analytics when every channel has an adapter", async () => {
    await render();
    expect(text()).not.toContain("Analytics unavailable");
  });

  it("says so when no post is measured yet", async () => {
    await render();
    expect(text()).toContain("No measured posts yet");
  });

  it("names the Mission types whose Template does not declare analytics", async () => {
    emptyReason = { reason: "not_opted_in", missionTypes: ["Create article (SEO)"], templates: ["SEO"] };
    await render();
    expect(text()).toContain("The Template (SEO) of this Project does not declare analytics for Create article (SEO). Update the Template to measure these posts.");
  });

  it("names the channels that are not linked to the adapter and links to the publishers page", async () => {
    emptyReason = { reason: "not_linked", channels: ["Blog", "Docs"], adapterName: "Search Console" };
    await render();
    expect(text()).toContain("No channel (Blog, Docs) is linked to Search Console.");
    expect(container.querySelector('a[href="publishers"]')).not.toBeNull();
  });

  it("counts the posts waiting for a first reading and gives the next date", async () => {
    emptyReason = { reason: "waiting", count: 2, nextAt: Date.UTC(2026, 10, 25, 12) };
    await render();
    expect(text()).toContain("2 posts are waiting for their first reading, the next one on ");
    expect(text()).toContain("2026");
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
    adapters = [SEARCH_CONSOLE];
    rows = [row({ title: "Post", snapshots: [snap(3 * DAY, { clicks: 12 }), snap(7 * DAY, { clicks: 46 })] })];
    await render();
    expect(listed()[0]).toContain("46");
    expect(listed()[0]).toContain("+34");
    expect(detail()).toContain("+34");
  });

  it("shows no variation under a counter with a single Snapshot", async () => {
    adapters = [SEARCH_CONSOLE];
    rows = [row({ title: "Post", snapshots: [snap(3 * DAY, { clicks: 12 })] })];
    await render();
    expect(listed()[0]).toContain("12");
    expect(listed()[0]).not.toMatch(/[+\u2212-]\d/);
    expect(detail()).not.toMatch(/[+\u2212]\d/);
  });

  it("compares only the Snapshots of the post's current series", async () => {
    adapters = [SEARCH_CONSOLE];
    rows = [row({ title: "Post", snapshots: [snap(3 * DAY, { clicks: 500 }, 0), snap(7 * DAY, { clicks: 20 }, 1)] })];
    await render();
    expect(listed()[0]).toContain("20");
    expect(listed()[0]).not.toMatch(/[+\u2212-]\d/);
  });

  it("points an improving arrow when a level where lower is better goes down", async () => {
    adapters = [SEARCH_CONSOLE];
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

  describe("Publications, Recipes and Families views (ADR-084)", () => {
    const view = (name: string) => Array.from(container.querySelectorAll<HTMLButtonElement>('[role="tablist"][aria-label="Analytics view"] [role="tab"]')).find((t) => t.textContent === name)!;
    const open = async (name: string) => act(async () => view(name).click());
    const trigger = (label: string) => container.querySelector<HTMLElement>(`[aria-label="${label}"]`)!;
    const nativeSelect = (label: string) => trigger(label).closest('[data-slot="native-select-wrapper"]')!.querySelector<HTMLSelectElement>("select")!;
    const choose = async (label: string, value: string) =>
      act(async () => {
        const el = nativeSelect(label);
        Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(el, value);
        el.dispatchEvent(new Event("change", { bubbles: true }));
      });
    beforeEach(() => {
      rows = [row({ title: "Reel", snapshots: [snap(DAY, { views: 12 })] })];
    });
    const stat = (observations: number, mean: number, median: number, sum?: number) => ({ observations, mean, median, ...(sum !== undefined ? { sum } : {}) });
    const reading = (adapter: string, over: Record<string, unknown> = {}) => ({
      adapter,
      publications: 3,
      measured: 2,
      freshness: { oldestReadingAt: Date.UTC(2026, 10, 10), newestReadingAt: Date.UTC(2026, 10, 12) },
      platforms: [{ platform: "instagram", publications: 3, measured: 2, metrics: { views: stat(2, 150, 150, 300) } }],
      ...over,
    });
    const recipe = (over: Record<string, unknown> = {}) => ({
      recipeId: "rec-1",
      recipeName: "Close-up",
      archived: false,
      publications: 3,
      lastPublishedAt: Date.UTC(2026, 10, 15),
      versions: [{ version: 2, publications: 3, lastPublishedAt: Date.UTC(2026, 10, 15) }],
      adapters: [reading("postiz")],
      unavailable: [],
      ...over,
    });
    const family = (over: Record<string, unknown> = {}) => ({
      familyId: "fam-1",
      familyName: "Reaction",
      archived: false,
      publications: 3,
      lastPublishedAt: Date.UTC(2026, 10, 15),
      adapters: [reading("postiz")],
      unavailable: [],
      recipes: [recipe()],
      ...over,
    });

    it("offers the three views in each adapter tab, opening on Publications", async () => {
      rows = [row({ title: "Reel", snapshots: [snap(DAY, { views: 12 })] })];
      await render();
      expect(Array.from(container.querySelectorAll('[aria-label="Analytics view"] [role="tab"]')).map((t) => [t.textContent, t.getAttribute("aria-selected")])).toEqual([
        ["Publications", "true"],
        ["Recipes", "false"],
        ["Families", "false"],
      ]);
      expect(listed()[0]).toContain("Reel");
    });

    it("shows each Publication's recipe, version and family, or Unattributed", async () => {
      rows = [
        row({ title: "Made", snapshots: [snap(DAY, { views: 12 })], attribution: { recipeId: "rec-1", recipeName: "Close-up", version: 2, familyId: "fam-1", familyName: "Reaction" } }),
        row({ title: "Free", snapshots: [snap(2 * DAY, { views: 5 })] }),
      ];
      await render();
      const made = listed().find((t) => t.includes("Made"))!;
      expect(made).toContain("Close-up v2 · Reaction");
      expect(made).not.toContain("Unattributed");
      expect(listed().find((t) => t.includes("Free"))).toContain("Unattributed");
    });

    it("lists the recipes with Publications, concisely, and opens the figures platform by platform", async () => {
      recipeSummary = { groupBy: "recipe", recipes: [recipe()], unattributed: 4, partial: false };
      await render();
      await open("Recipes");
      const list = container.querySelector('ul[aria-label="Recipes"]')!;
      expect(list.textContent).toContain("Close-up");
      expect(list.textContent).toContain("3 Publications");
      expect(list.textContent).toContain("2 measured");
      expect(list.textContent).not.toContain("Views");
      expect(text()).toContain("4 Unattributed Publications are in no recipe");
      await act(async () => list.querySelector<HTMLButtonElement>("button[aria-expanded]")!.click());
      const figures = list.textContent ?? "";
      expect(figures).toContain("Instagram");
      expect(figures).toContain("reported by 2 of 3");
      expect(figures).toContain("v2 (3 Publications)");
    });

    it("shows no Mission, Run or usage figure and no recipe without Publications", async () => {
      recipeSummary = { groupBy: "recipe", recipes: [recipe()], unattributed: 0, partial: false };
      await render();
      await open("Recipes");
      expect(text()).not.toMatch(/Missions?\b.*(created|count)|Runs?\b|Never used|attempt/i);
      expect(container.querySelectorAll('ul[aria-label="Recipes"] > li')).toHaveLength(1);
    });

    it("never shows a group through another adapter's tab", async () => {
      adapters = [SOCIAL_ADAPTER, { ...SOCIAL_ADAPTER, adapter: "search", name: "Search" }];
      recipeSummary = { groupBy: "recipe", recipes: [recipe({ adapters: [reading("search")] })], unattributed: 0, partial: false };
      await render();
      await open("Recipes");
      expect(container.querySelectorAll('ul[aria-label="Recipes"] > li')).toHaveLength(0);
    });

    it("lists the families and says which recipes they hold", async () => {
      familySummary = { groupBy: "family", families: [family()], unattributed: 0, partial: false };
      await render();
      await open("Families");
      await act(async () => container.querySelector<HTMLButtonElement>('ul[aria-label="Families"] button[aria-expanded]')!.click());
      expect(container.querySelector('ul[aria-label="Families"]')!.textContent).toContain("Recipes: Close-up (3 Publications)");
    });

    it("drills down from a group to its Publications through the same filters", async () => {
      recipeSummary = { groupBy: "recipe", recipes: [recipe()], unattributed: 0, partial: false };
      familySummary = { groupBy: "family", families: [family()], unattributed: 0, partial: false };
      await render();
      await open("Recipes");
      await act(async () => container.querySelector<HTMLButtonElement>('ul[aria-label="Recipes"] button[aria-expanded]')!.click());
      const show = Array.from(container.querySelectorAll("button")).find((b) => b.textContent === "Show Publications")!;
      await act(async () => show.click());
      expect(view("Publications").getAttribute("aria-selected")).toBe("true");
      expect(listArgs.at(-1)).toMatchObject({ recipeId: "rec-1" });
      expect(nativeSelect("Filter by recipe").value).toBe("rec-1");
    });

    it("reads the summaries and the list over the chosen period and platform", async () => {
      await render();
      expect(summaryArgs.at(-1)).toMatchObject({ days: 365 });
      await choose("Filter by period", "30");
      expect(summaryArgs.at(-1)).toMatchObject({ days: 30 });
      expect(listArgs.at(-1)?.from).toBeGreaterThan(Date.now() - 31 * 24 * 3_600_000);
      await choose("Filter by platform", "instagram");
      expect(summaryArgs.at(-1)).toMatchObject({ days: 30, platform: "instagram" });
    });

    it("keeps the filters reachable when they leave no Publication", async () => {
      familySummary = { groupBy: "family", families: [family()], unattributed: 0, partial: false };
      rows = (args) => (args.familyId ? [] : [row({ title: "Reel", snapshots: [snap(DAY, { views: 12 })] })]);
      await render();
      await choose("Filter by family", "fam-1");
      expect(listArgs.at(-1)).toMatchObject({ familyId: "fam-1" });
      expect(text()).toContain("No posts match these filters.");
    });
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
      adapters = [SEARCH];
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
      adapters = [SEARCH];
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
      adapters = [{ ...SEARCH, primary: "position" }];
      rows = [
        row({ title: "Deep", snapshots: [snap(DAY, { position: 30, clicks: 900 })] }),
        row({ title: "Near top", snapshots: [snap(DAY, { position: 2, clicks: 1 })] }),
      ];
      await render();
      expect(listed()[0]).toContain("Near top");
      expect(totals()).toMatch(/Near top/);
    });

    describe("the adapter picker", () => {
      const COUNTER_ADAPTER = { adapter: "postiz", name: "Postiz", primary: "views", metrics: [counter("views", "Views")] };
      const picker = () => container.querySelector('[role="tablist"][aria-label="Analytics adapter"]');
      const tabs = () => Array.from(picker()!.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
      const choose = async (name: string) => {
        const tab = tabs().find((x) => x.textContent === name)!;
        await act(async () => {
          tab.click();
        });
      };

      it("is hidden with a single adapter", async () => {
        adapters = [SEARCH];
        rows = [row({ title: "Page", snapshots: [snap(DAY, { clicks: 40 })] })];
        await render();
        expect(picker()).toBeNull();
      });

      it("lists the adapters, opens on the first one and shows the columns of the chosen one", async () => {
        adapters = [COUNTER_ADAPTER, SEARCH];
        rows = ({ adapter }) =>
          adapter === "search" ? [row({ title: "Article", snapshots: [snap(DAY, { clicks: 40, impressions: 800 })] })] : [row({ title: "Reel", snapshots: [snap(DAY, { views: 12 })] })];
        await render();
        expect(picker()).not.toBeNull();
        expect(headers()).toContain("Views");
        expect(listed()[0]).toContain("Reel");
        expect(tabs().map((x) => [x.textContent, x.getAttribute("aria-selected")])).toEqual([["Postiz", "true"], [SEARCH.name, "false"]]);
        await choose(SEARCH.name);
        expect(listArgs.at(-1)).toMatchObject({ adapter: "search" });
        expect(headers()).toEqual(expect.arrayContaining(["Clicks", "Impressions"]));
        expect(headers()).not.toContain("Views");
        expect(listed()).toHaveLength(1);
        expect(listed()[0]).toContain("Article");
      });
    });

    it("shows a dash for a metric with no value, and nothing for a metric no longer declared", async () => {
      adapters = [SEARCH];
      rows = [row({ title: "Page", snapshots: [snap(DAY, { clicks: 40, views: 999 })] })];
      await render();
      expect(listed()[0]).toContain("—");
      expect(listed()[0]).not.toContain("999");
      expect(detail()).not.toContain("999");
      expect(detail()).not.toContain("Views");
    });
  });
});
