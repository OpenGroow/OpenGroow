/** @vitest-environment jsdom */

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CreativeFamilyContent } from "../src/components/creative-family-page";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const useQueryMock = vi.fn();
const usePaginatedQueryMock = vi.fn();
const requestThumbnailsMock = vi.fn();
const loadMore = vi.fn();

vi.mock("convex/react", () => ({
  useQuery: (...args: unknown[]) => useQueryMock(...args),
  usePaginatedQuery: (...args: unknown[]) => usePaginatedQueryMock(...args),
  useMutation: () => requestThumbnailsMock,
}));

vi.mock("@convex/_generated/api", () => ({
  api: {
    creative_families: { get: "creative_families.get", stats: "creative_families.stats", listSources: "creative_families.listSources" },
    creative_families_archive: { archive: "creative_families_archive.archive", unarchive: "creative_families_archive.unarchive" },
    source_thumbnails: { request: "source_thumbnails.request" },
    source_platforms: { forInstance: "source_platforms.forInstance" },
  },
}));

const FAMILY = { _id: "fam-1", slug: "reaction", name: "Reaction", description: "A close-up reaction", status: "active" };
const STATS = { sourceCount: 4, withViewsCount: 2, medianViews: 1500, maxViews: 2000, truncated: false };
const PLATFORMS = [{ templateId: "@opengroow/seo", sourceId: "post", name: "Reddit" }];

function makeSource(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    _id: "src-1",
    templateId: "@opengroow/seo",
    sourceId: "post",
    label: "Post",
    family: "social-video",
    origin: "https://example.com/post-1",
    createdAt: Date.UTC(2026, 0, 15),
    marketing: { summary: "A reaction clip" },
    analysis: {},
    thumbnailUrl: "https://example.com/t.jpg",
    ...overrides,
  };
}

describe("CreativeFamilyContent", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    useQueryMock.mockReset();
    usePaginatedQueryMock.mockReset();
    loadMore.mockReset();
    requestThumbnailsMock.mockReset().mockResolvedValue(undefined);
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

  async function render(overrides: { family?: unknown; stats?: unknown; sources?: unknown[]; status?: string } = {}) {
    const { family = FAMILY, stats = STATS, sources = [], status = "Exhausted" } = overrides;
    useQueryMock.mockImplementation((key: string) =>
      key === "creative_families.get" ? family : key === "creative_families.stats" ? stats : key === "source_platforms.forInstance" ? PLATFORMS : undefined,
    );
    usePaginatedQueryMock.mockReturnValue({ results: sources, status, loadMore });
    await act(async () => {
      root.render(<CreativeFamilyContent instanceId="instance-1" familyId="fam-1" />);
    });
  }

  const text = () => document.body.textContent ?? "";

  it("shows loading, then not found", async () => {
    useQueryMock.mockReturnValue(undefined);
    usePaginatedQueryMock.mockReturnValue({ results: [], status: "LoadingFirstPage", loadMore });
    await act(async () => {
      root.render(<CreativeFamilyContent instanceId="instance-1" familyId="fam-1" />);
    });
    expect(text()).toContain("Loading");
    await render({ family: null });
    expect(text()).toContain("Creative Family not found");
  });

  it("shows the name, description, status and a link back to the library", async () => {
    await render();
    expect(text()).toContain("Reaction");
    expect(text()).toContain("A close-up reaction");
    expect(text()).toContain("Active");
    expect(document.body.querySelector('a[href="/projects/instance-1/library"]')).not.toBeNull();
  });

  it("offers Archive for an active family and Unarchive for an archived one", async () => {
    const buttons = () => Array.from(document.body.querySelectorAll("button")).map((b) => b.textContent);
    await render();
    expect(buttons()).toContain("Archive");
    await render({ family: { ...FAMILY, status: "archived" } });
    expect(buttons()).toContain("Unarchive");
  });

  it("shows the statistics: Sources with views out of the total, median and maximum", async () => {
    await render();
    expect(text()).toContain("2 of 4");
    expect(text()).toContain("1,500");
    expect(text()).toContain("2,000");
    expect(text()).not.toContain("truncated");
    expect(text()).not.toContain("first 500");
  });

  it("shows unknown, not zero, when no Source has views", async () => {
    await render({ stats: { sourceCount: 3, withViewsCount: 0, medianViews: null, maxViews: null, truncated: false } });
    expect(text()).toContain("0 of 3");
    expect(document.body.querySelector('[aria-label="Statistics"]')?.textContent).toContain("Unknown");
  });

  it("warns when the statistics cover a truncated sample", async () => {
    await render({ stats: { ...STATS, truncated: true } });
    expect(text()).toContain("first 500 Sources");
  });

  it("lists each Source with thumbnail, platform, original link, date and the metrics collected", async () => {
    await render({
      sources: [makeSource({ analysis: { viewCount: 12000, likeCount: 300, postUrl: "https://example.com/original", creativeFeatures: { mediaType: "video" } } })],
    });
    const row = document.body.querySelector("li") as HTMLElement;
    expect(row.textContent).toContain("A reaction clip");
    expect(row.textContent).toContain("Reddit");
    expect(row.textContent).toMatch(/15.*2026/);
    expect(row.querySelector("img")?.getAttribute("src")).toBe("https://example.com/t.jpg");
    expect(row.querySelector('a[aria-label="Open original"]')?.getAttribute("href")).toBe("https://example.com/original");
    expect(row.querySelector('a[href="/projects/instance-1/sources/src-1"]')).not.toBeNull();
    expect(row.textContent).toContain("Views12,000");
    expect(row.textContent).toContain("Likes300");
  });

  it("shows a missing metric as unknown, never 0", async () => {
    await render({ sources: [makeSource({ analysis: { viewCount: 0 } })] });
    const row = document.body.querySelector("li") as HTMLElement;
    expect(row.textContent).toContain("Views0");
    expect(row.textContent).toContain("LikesUnknown");
    expect(row.textContent).toContain("SharesUnknown");
  });

  it("says when the family has no Source, and loads more pages", async () => {
    await render({ stats: { sourceCount: 0, withViewsCount: 0, medianViews: null, maxViews: null, truncated: false } });
    expect(text()).toContain("No Sources in this family");
    await render({ sources: [makeSource()], status: "CanLoadMore" });
    const more = Array.from(document.body.querySelectorAll("button")).find((b) => b.textContent === "Load more");
    await act(async () => {
      more?.click();
    });
    expect(loadMore).toHaveBeenCalled();
  });
});
