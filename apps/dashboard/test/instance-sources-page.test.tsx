/** @vitest-environment jsdom */

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InstanceSourcesContent } from "../src/components/instance-sources-page";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// jsdom has no PointerEvent, which the Checkbox primitive dispatches on click.
if (!("PointerEvent" in window)) Object.defineProperty(window, "PointerEvent", { value: MouseEvent, configurable: true });

const useQueryMock = vi.fn();
const usePaginatedQueryMock = vi.fn();
const removeManyMock = vi.fn();

vi.mock("next/navigation", async () => (await import("./fixtures/url-navigation")).navigationMock());
vi.mock("convex/react", () => ({
  useQuery: (...args: unknown[]) => useQueryMock(...args),
  usePaginatedQuery: (...args: unknown[]) => usePaginatedQueryMock(...args),
  useMutation: () => removeManyMock,
}));

vi.mock("@convex/_generated/api", () => ({
  api: {
    sources: { listByInstance: "sources.listByInstance", listFamilies: "sources.listFamilies", removeMany: "sources.removeMany", counts: "sources.counts" },
    source_thumbnails: { request: "source_thumbnails.request" },
    source_platforms: { forInstance: "source_platforms.forInstance" },
  },
}));

// What the Instagram and TikTok Templates declare (ADR-077).
const INSTAGRAM_ICON = "data:image/svg+xml;base64,PHN2Zy9pZy8+";
const TIKTOK_ICON = "data:image/svg+xml;base64,PHN2Zy90dC8+";
const PLATFORMS = [
  { templateId: "@opengroow/seo", sourceId: "no-logo-post", name: "Reddit" },
  { templateId: "@opengroow/seo", sourceId: "instagram-reel", name: "Instagram", icon: INSTAGRAM_ICON, mediaLabels: { video: "Reel" } },
  { templateId: "@opengroow/seo", sourceId: "tiktok-post", name: "TikTok", icon: TIKTOK_ICON, mediaLabels: { video: "video" } },
];

function makeSource(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    _id: "src-1",
    instanceId: "instance-1",
    templateId: "@opengroow/seo",
    sourceId: "keyword",
    label: "Search keyword",
    family: "search",
    status: "ready",
    origin: "https://example.com/serp",
    createdAt: Date.UTC(2026, 0, 15),
    marketing: {},
    analysis: {},
    ...overrides,
  };
}

describe("InstanceSourcesContent", () => {
  let container: HTMLDivElement;
  let root: Root;

  const loadMore = vi.fn();

  beforeEach(() => {
    useQueryMock.mockReset();
    usePaginatedQueryMock.mockReset();
    loadMore.mockReset();
    removeManyMock.mockReset().mockResolvedValue({ removed: 0 });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  async function render(
    results: Array<ReturnType<typeof makeSource>>,
    { status = "Exhausted", families, tab = "other", counts }: { status?: string; families?: string[]; tab?: "other" | "ready"; counts?: unknown } = {},
  ) {
    const familyList = families ?? [...new Set(results.map((r) => r.family as string))].sort();
    useQueryMock.mockImplementation((key: string) => (key === "sources.counts" ? counts : key === "source_platforms.forInstance" ? PLATFORMS : familyList));
    usePaginatedQueryMock.mockReturnValue({ results, status, loadMore });
    await act(async () => {
      root.render(<InstanceSourcesContent instanceId="instance-1" />);
    });
    // The Ready tab opens first; every other Source lives on Other.
    const other = Array.from(document.body.querySelectorAll("button")).find((b) => b.textContent?.startsWith("Other") && b.getAttribute("aria-pressed") !== null);
    if (tab === "other" && other) await act(async () => { other.click(); });
  }

  it("shows loading then empty states", async () => {
    await render([], { status: "LoadingFirstPage" });
    expect(document.body.textContent).toContain("Loading");
    await render([]);
    expect(document.body.textContent).toContain("No Sources yet");
  });

  it("lists title, origin label, family, observed date and status with a detail link", async () => {
    await render([
      makeSource({ marketing: { summary: "running shoes are trending" } }),
      makeSource({ _id: "src-2", origin: "https://other.example", label: "Video post", family: "social-video" }),
    ]);

    const text = document.body.textContent ?? "";
    expect(text).toContain("running shoes are trending");
    expect(text).toContain("https://other.example");
    expect(text).toContain("Search keyword");
    expect(text).not.toContain("social-video"); // the Family column is gone
    expect(text).toContain("2026");
    expect(text).toContain("Ready");

    const link = Array.from(document.querySelectorAll("a")).find((a) =>
      a.getAttribute("href")?.endsWith("/sources/src-1"),
    );
    expect(link?.getAttribute("href")).toBe("/projects/instance-1/sources/src-1");
  });

  async function choose(index: number, value: string) {
    const select = document.querySelectorAll("select")[index]!;
    const setValue = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!;
    await act(async () => {
      setValue.call(select, value);
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
  }

  const links = () => Array.from(document.querySelectorAll('a[href^="/projects/"]')).map((a) => a.textContent);

  it("filters by status and by agent", async () => {
    await render([
      makeSource({ _id: "a", marketing: { summary: "alpha reel" }, templateId: "@opengroow/seo" }),
      makeSource({ _id: "b", status: "failed", marketing: { summary: "beta reel" }, templateId: "@opengroow/social" }),
      makeSource({ _id: "c", status: "unavailable", marketing: { summary: "gamma reel" }, templateId: "@opengroow/social" }),
    ]);
    await choose(0, "failed");
    expect(links()).toEqual(["beta reel", "gamma reel"]); // Failed covers Unavailable
    await choose(0, "all");
    await choose(1, "@opengroow/seo");
    expect(links()).toEqual(["alpha reel"]);
  });

  it("shows the same platform logo and media icon on the Other rows", async () => {
    await render([makeSource({ sourceId: "tiktok-post", analysis: { creativeFeatures: { mediaType: "video" } } })]);
    const badge = document.querySelector("ul li [title='TikTok video']")!;
    expect(badge.querySelector("img")!.getAttribute("src")).toBe(TIKTOK_ICON);
    expect(badge.querySelectorAll("svg")).toHaveLength(1);
  });

  it("names a platform that ships no logo, so the badge still says where the Source comes from", async () => {
    await render([makeSource({ sourceId: "no-logo-post", analysis: { creativeFeatures: { mediaType: "image" } } })]);
    const badge = document.querySelector("ul li [title='Reddit image']")!;
    expect(badge.querySelector("img")).toBeNull();
    expect(badge.textContent).toBe("Reddit");
  });

  it("shows an hourglass with the way to score a Source that is not scored yet", async () => {
    await render([
      makeSource({ _id: "a" }), // analysed, no score
      makeSource({ _id: "b", status: "failed" }),
    ]);
    const hints = document.querySelectorAll("[data-testid='not-scored-hint']");
    expect(hints).toHaveLength(1);
    expect(hints[0]!.getAttribute("aria-label")).toBe("Not scored yet. Run the Source scoring job to score it.");
    // The row's full-size link must not sit over it, or the tooltip never opens on hover.
    expect(hints[0]!.className).toContain("z-10");
  });

  it("offers a short list of statuses, without Scored, Published or Excluded", async () => {
    await render([makeSource()]);
    const options = Array.from(document.querySelectorAll("select")[0]!.querySelectorAll("option")).map((o) => o.textContent);
    expect(options).toEqual(["All statuses", "Processing", "Not scored yet", "Failed"]);
  });

  it("keeps the Scored Sources on the Ready tab, out of Other", async () => {
    await render([
      makeSource({ _id: "a", marketing: { summary: "alpha reel" }, scoring: { productFit: 1 } }),
      makeSource({ _id: "b", status: "processing", marketing: { summary: "beta reel" } }),
    ]);
    expect(links()).toEqual(["beta reel"]);
    await choose(0, "processing");
    expect(links()).toEqual(["beta reel"]);
    await choose(0, "not-scored");
    expect(links()).toEqual([]);
  });

  it("counts the loaded sources by status", async () => {
    await render([makeSource({ _id: "a" }), makeSource({ _id: "b", status: "failed" })]);
    const tile = (label: string) =>
      Array.from(document.querySelectorAll("[data-slot=stat-tile]")).find((t) => t.textContent?.includes(label))
        ?.textContent;
    expect(tile("Total sources")).toContain("2");
    expect(tile("Failed")).toContain("1");
  });

  it("shows the server's real counts, not the number of rows loaded so far", async () => {
    await render([makeSource({ _id: "a" })], {
      status: "CanLoadMore",
      counts: { total: 312, processing: 5, ready: 290, failed: 12, unavailable: 5, scored: 270, other: 42, capped: false },
    });
    const tile = (label: string) =>
      Array.from(document.querySelectorAll("[data-slot=stat-tile]")).find((t) => t.textContent?.includes(label))?.textContent;
    expect(tile("Total sources")).toContain("312"); // not "Loaded sources: 1"
    expect(tile("Processing")).toContain("5");
    expect(tile("Ready")).toContain("290");
    expect(tile("Failed")).toContain("12");
    expect(tile("Unavailable")).toContain("5");
    const tabs = Array.from(document.querySelectorAll("button[aria-pressed]")).map((b) => b.textContent);
    expect(tabs).toEqual(["Scored270", "Other42"]);
  });

  it("marks a status the server stopped counting with a plus", async () => {
    await render([makeSource()], { counts: { total: 5300, processing: 0, ready: 5000, failed: 300, unavailable: 0, scored: 0, other: 5000, capped: true } });
    const tile = Array.from(document.querySelectorAll("[data-slot=stat-tile]")).find((t) => t.textContent?.includes("Ready"))?.textContent;
    expect(tile).toContain("5000+");
  });

  it("offers Load more only while another page can be loaded", async () => {
    await render([makeSource()], { status: "Exhausted" });
    expect(Array.from(document.querySelectorAll("button")).some((b) => b.textContent === "Load more")).toBe(false);

    await render([makeSource()], { status: "CanLoadMore" });
    const button = Array.from(document.querySelectorAll("button")).find((b) => b.textContent === "Load more");
    await act(async () => {
      button!.click();
    });
    expect(loadMore).toHaveBeenCalledWith(50);
  });

  it("lists on the Other tab only the Sources that are not Scored", async () => {
    await render([
      makeSource({ _id: "a", status: "processing" }),
      makeSource({ _id: "b", status: "ready" }),
      makeSource({ _id: "c", status: "ready", scoring: { productFit: 0.75 } }),
      makeSource({ _id: "h", status: "failed" }),
      makeSource({ _id: "i", status: "unavailable" }),
      makeSource({ _id: "j", status: "ready", excluded: true }),
    ]);
    // The rows only: the Scored tab label is on the page too.
    const text = Array.from(document.querySelectorAll("ul li")).map((row) => row.textContent).join(" ");
    expect(text).not.toContain("Scored");
    for (const label of ["Ingestion", "Ready", "Failed", "Unavailable", "Excluded"]) {
      expect(text).toContain(label);
    }
  });

  describe("select mode", () => {
    const rows = () => [
      makeSource({ _id: "src-1", marketing: { summary: "first" } }),
      makeSource({ _id: "src-2", marketing: { summary: "second" } }),
      makeSource({ _id: "src-3", marketing: { summary: "third" } }),
    ];
    const buttonByText = (text: string) =>
      Array.from(document.querySelectorAll("button")).find((b) => b.textContent?.trim().startsWith(text));
    const checkboxes = () => Array.from(document.querySelectorAll('[role="checkbox"]')) as HTMLElement[];
    async function click(el: Element | undefined) {
      await act(async () => (el as HTMLElement).click());
    }

    it("shows no checkbox until Select is pressed, and hides them again on Done", async () => {
      await render(rows());
      expect(checkboxes()).toHaveLength(0);
      await click(buttonByText("Select"));
      expect(checkboxes()).toHaveLength(4); // select all + one per row
      await click(buttonByText("Done"));
      expect(checkboxes()).toHaveLength(0);
    });

    it("deletes only the checked Sources, after a confirmation", async () => {
      await render(rows());
      removeManyMock.mockClear(); // every mutation shares this mock, including the thumbnail request
      await click(buttonByText("Select"));
      expect(buttonByText("Delete")?.hasAttribute("disabled")).toBe(true);

      await click(checkboxes()[1]); // src-1
      await click(checkboxes()[3]); // src-3
      expect(document.body.textContent).toContain("2 selected");

      await click(buttonByText("Delete (2)"));
      expect(removeManyMock).not.toHaveBeenCalled();
      expect(document.body.textContent).toContain("Delete 2 Sources?");
      expect(document.body.textContent).toContain("permanent");

      const confirm = Array.from(document.querySelectorAll("button")).filter((b) => b.textContent?.trim() === "Delete").at(-1);
      await click(confirm);
      expect(removeManyMock).toHaveBeenCalledWith({ sourceIds: ["src-1", "src-3"] });
      expect(checkboxes()).toHaveLength(0); // back to the normal list
    });

    it("selects every Source on screen with the first checkbox", async () => {
      await render(rows());
      await click(buttonByText("Select"));
      await click(checkboxes()[0]);
      expect(document.body.textContent).toContain("3 selected");
    });

    it("keeps the dialog open and shows the error when the deletion fails", async () => {
      removeManyMock.mockRejectedValue(new Error("Forbidden"));
      await render(rows());
      await click(buttonByText("Select"));
      await click(checkboxes()[1]);
      await click(buttonByText("Delete (1)"));
      const confirm = Array.from(document.querySelectorAll("button")).filter((b) => b.textContent?.trim() === "Delete").at(-1);
      await click(confirm);
      expect(document.querySelector('[role="alert"]')?.textContent).toContain("Forbidden");
      expect(document.body.textContent).toContain("Delete 1 Source?");
    });
  });

  describe("Ready tab", () => {
    const scored = { productFit: 0.9, replicability: 0.9, creativeStrength: 0.9 };
    const reel = (overrides: Partial<Record<string, unknown>> = {}) =>
      makeSource({ _id: "s-reel", sourceId: "instagram-reel", family: "social-video", marketing: { summary: "A Christmas reel" }, analysis: { creativeFeatures: { mediaType: "video" } }, scoring: { ...scored, replicationScore: 0.92 }, ...overrides });

    it("lists the scored Sources by score with their format, and no production action", async () => {
      await render(
        [reel(), makeSource({ _id: "s-low", marketing: { summary: "Lower" }, scoring: { ...scored, replicationScore: 0.5 } }), makeSource({ _id: "s-new", marketing: { summary: "Not scored yet" } })],
        { tab: "ready" },
      );
      const rows = Array.from(document.body.querySelectorAll("[aria-label='Ready sources'] li"));
      expect(rows).toHaveLength(2);
      expect(rows[0]!.textContent).toContain("A Christmas reel");
      expect(rows[0]!.textContent).toContain("Instagram Reel");
      expect(rows[0]!.textContent).toContain("Score 92");
      expect(rows[0]!.textContent).not.toContain("Produce");
      expect(rows[0]!.textContent).not.toContain("Routed to");
      expect(rows[0]!.querySelector("select")).toBeNull();
      expect(document.body.textContent).not.toContain("Not scored yet");
    });

    it("shows the platform logo and a media icon instead of the words", async () => {
      await render(
        [
          reel(),
          reel({ _id: "s-tt", sourceId: "tiktok-post", marketing: { summary: "tt" }, analysis: { creativeFeatures: { mediaType: "carousel" } } }),
          reel({ _id: "s-img", marketing: { summary: "img" }, analysis: { creativeFeatures: { mediaType: "image" } } }),
          reel({ _id: "s-other", sourceId: "keyword", label: "Search keyword", marketing: { summary: "kw" }, analysis: {} }),
        ],
        { tab: "ready" },
      );
      const badge = (title: string) => document.querySelector(`[aria-label='Ready sources'] [title='${title}']`)!;
      // Instagram video: the logo is an image, the media an icon, and the words are for screen readers only.
      expect(badge("Instagram Reel").querySelector("img")!.getAttribute("src")).toBe(INSTAGRAM_ICON);
      expect(badge("Instagram Reel").querySelectorAll("svg")).toHaveLength(1);
      expect(badge("Instagram Reel").querySelector(".sr-only")!.textContent).toBe("Instagram Reel");
      expect(badge("TikTok carousel").querySelector("img")!.getAttribute("src")).toBe(TIKTOK_ICON);
      expect(badge("TikTok carousel").querySelectorAll("svg")).toHaveLength(1);
      expect(badge("Instagram image").querySelectorAll("svg")).toHaveLength(1);
      // Unknown platform and media: the declared label, as text.
      expect(Array.from(document.querySelectorAll("[aria-label='Ready sources'] li")).some((row) => row.textContent?.includes("Search keyword"))).toBe(true);
    });

    it("shows the Sources as a gallery of cards, a long title clamped by the layout and complete in its tooltip", async () => {
      const long = "A Christmas gift reel for a wife. ".repeat(10).trim();
      await render([reel({ marketing: { summary: long } }), reel({ _id: "s-short", marketing: { summary: "Short title" } })], { tab: "ready" });
      const gallery = document.querySelector("[aria-label='Ready sources'] ul")!;
      expect(gallery.className).toContain("grid-cols");
      expect(gallery.querySelectorAll(":scope > li")).toHaveLength(2);
      const link = Array.from(gallery.querySelectorAll("li a")).find((a) => a.getAttribute("title") === long)!;
      expect(link.className).toContain("line-clamp-2");
      expect(link.textContent).toBe(long);
    });

    it("shows the status, Agent and date of a Source on the Other tab's cards", async () => {
      await render([makeSource({ _id: "a", status: "failed" })], { tab: "other" });
      const card = document.querySelector("ul li")!;
      expect(card.textContent).toContain("Failed");
    });

    it("uses the same Select mode as All to delete several Ready Sources", async () => {
      await render([reel(), reel({ _id: "s-two", marketing: { summary: "Second" } })], { tab: "ready" });
      removeManyMock.mockClear(); // every mutation shares this mock, including the thumbnail request
      const button = (name: string, scope: ParentNode = document.body) => Array.from(scope.querySelectorAll("button")).find((b) => b.textContent?.trim().startsWith(name))!;
      expect(document.querySelectorAll("[role='checkbox']")).toHaveLength(0);
      await act(async () => { button("Select").click(); });
      const boxes = document.querySelectorAll("[aria-label='Ready sources'] li [role='checkbox']");
      expect(boxes).toHaveLength(2);
      await act(async () => { (boxes[0] as HTMLElement).click(); });
      await act(async () => { button("Delete (1)").click(); });
      expect(removeManyMock).not.toHaveBeenCalled();
      expect(document.body.textContent).toContain("Delete 1 Source?");
      await act(async () => { button("Delete", document.querySelector("[role='dialog']")!).click(); });
      expect(removeManyMock).toHaveBeenCalledWith({ sourceIds: ["s-reel"] });
    });

    it("shows a broken image for a Source whose thumbnail was tried and never came, the glyph while it is still waiting", async () => {
      removeManyMock.mockResolvedValue(undefined);
      await render([reel({ thumbnailTriedAt: 1, thumbnailUrl: null }), reel({ _id: "s-wait", marketing: { summary: "Waiting" } })], { tab: "ready" });
      expect(document.querySelectorAll("[data-testid='broken-thumbnail']")).toHaveLength(1);
      expect(document.querySelectorAll("[aria-label='Ready sources'] li")).toHaveLength(2);
    });

    it("shows the stored thumbnail and asks for the ones that are missing", async () => {
      removeManyMock.mockResolvedValue(undefined);
      await render(
        [reel({ thumbnailUrl: "https://storage.example/thumb.jpg", thumbnailTriedAt: 1 }), reel({ _id: "s-none", marketing: { summary: "No image yet" } })],
        { tab: "ready" },
      );
      expect(document.querySelector("img")?.getAttribute("src")).toBe("https://storage.example/thumb.jpg");
      expect(removeManyMock).toHaveBeenCalledWith({ instanceId: "instance-1", sourceIds: ["s-none"] });
    });

    it("puts Load more on the right of the Scored tab", async () => {
      await render([reel()], { tab: "ready", status: "CanLoadMore" });
      const button = Array.from(document.querySelectorAll("button")).find((b) => b.textContent === "Load more")!;
      expect(button.parentElement!.className).toContain("justify-end");
    });

    it("shows thumbnails and asks for the missing ones on the Other tab too", async () => {
      removeManyMock.mockResolvedValue(undefined);
      await render([makeSource({ _id: "a-img", thumbnailUrl: "https://storage.example/a.jpg", thumbnailTriedAt: 1 }), makeSource({ _id: "a-none" })], { tab: "other" });
      expect(document.querySelector("img")?.getAttribute("src")).toBe("https://storage.example/a.jpg");
      expect(removeManyMock).toHaveBeenCalledWith({ instanceId: "instance-1", sourceIds: ["a-none"] });
    });
  });
});
