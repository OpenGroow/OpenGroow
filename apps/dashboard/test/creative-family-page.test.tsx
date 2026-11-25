/** @vitest-environment jsdom */

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CreativeFamilyContent } from "../src/components/creative-family-page";

globalThis.PointerEvent ??= MouseEvent as typeof PointerEvent;

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
    creative_family_merge: { merge: "creative_family_merge.merge" },
    creative_families: { list: "creative_families.list", get: "creative_families.get", stats: "creative_families.stats", listSources: "creative_families.listSources" },
    creative_family_details: { create: "creative_family_details.create", update: "creative_family_details.update" },
    creative_family_sources: { assign: "creative_family_sources.assign", remove: "creative_family_sources.remove" },
    creative_families_archive: { archive: "creative_families_archive.archive", unarchive: "creative_families_archive.unarchive" },
    production_recipes: { list: "production_recipes.list", create: "production_recipes.create", listTargets: "production_recipes.listTargets" },
    source_thumbnails: { request: "source_thumbnails.request" },
    source_platforms: { forInstance: "source_platforms.forInstance" },
    recipe_generation: { generateRecipe: "recipe_generation.generateRecipe" },
    recipe_generation_views: { listGenerations: "recipe_generation_views.listGenerations" },
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

  it("shows the name, description and a link back to the library", async () => {
    await render();
    expect(text()).toContain("Reaction");
    expect(text()).toContain("A close-up reaction");
    expect(text()).not.toContain("Active");
    expect(document.body.querySelector('a[href="/projects/instance-1/library"]')).not.toBeNull();
  });

  it("shows where an archived merged family's Sources went", async () => {
    await render({ family: { ...FAMILY, status: "archived", mergedIntoId: "fam-2" } });
    const note = document.body.querySelector('[role="note"]') as HTMLElement;
    expect(note.textContent).toContain("Merged into");
    expect(note.querySelector('a[href="/projects/instance-1/library/fam-2"]')).not.toBeNull();
    expect(Array.from(document.body.querySelectorAll("button")).some((b) => b.textContent === "Merge into…")).toBe(false);
  });

  it("no longer offers the merge: it lives on the Library page", async () => {
    await render();
    expect(Array.from(document.body.querySelectorAll("button")).some((b) => b.textContent === "Merge into…")).toBe(false);
  });

  async function openMenu() {
    const trigger = document.querySelector('[aria-label="More actions"]')!;
    await act(async () => {
      for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
        trigger.dispatchEvent(new MouseEvent(type, { bubbles: true, button: 0 }));
      }
    });
    return () => Array.from(document.querySelectorAll('[role="menuitem"]')).map((i) => i.textContent);
  }

  it("keeps Edit and Delete in the more-actions menu, not as header buttons", async () => {
    await render();
    const headerButtons = Array.from(document.body.querySelectorAll("button")).map((b) => b.textContent);
    expect(headerButtons).not.toContain("Edit");
    expect(headerButtons).not.toContain("Archive");
    expect(headerButtons).not.toContain("Delete");
    expect((await openMenu())()).toEqual(["Edit", "Select", "Delete"]);
  });

  it("Delete archives the family", async () => {
    await render();
    await openMenu();
    await act(async () => (Array.from(document.querySelectorAll('[role="menuitem"]')).find((i) => i.textContent === "Delete") as HTMLElement).click());
    expect(requestThumbnailsMock).toHaveBeenCalledWith({ instanceId: "instance-1", familyId: "fam-1" });
  });

  it("selects Sources from the menu and removes them from the family", async () => {
    await render({ sources: [makeSource({ _id: "s1", label: "One" }), makeSource({ _id: "s2", label: "Two" })] });
    expect(Array.from(document.body.querySelectorAll("button")).some((b) => b.textContent === "Remove from family")).toBe(false);
    expect(document.querySelectorAll('[role="checkbox"]').length).toBe(0);
    await openMenu();
    await act(async () => (Array.from(document.querySelectorAll('[role="menuitem"]')).find((i) => i.textContent === "Select") as HTMLElement).click());
    const boxes = Array.from(document.querySelectorAll('[role="checkbox"]')) as HTMLElement[];
    expect(boxes.length).toBe(2);
    const removeButton = () => Array.from(document.body.querySelectorAll("button")).find((b) => b.textContent?.startsWith("Remove (")) as HTMLButtonElement;
    expect(removeButton().disabled).toBe(true);
    await act(async () => boxes[0]!.click());
    await act(async () => boxes[1]!.click());
    expect(removeButton().textContent).toBe("Remove (2)");
    requestThumbnailsMock.mockResolvedValue(null);
    await act(async () => removeButton().click());
    expect(requestThumbnailsMock).toHaveBeenCalledWith({ instanceId: "instance-1", sourceId: "s1" });
    expect(requestThumbnailsMock).toHaveBeenCalledWith({ instanceId: "instance-1", sourceId: "s2" });
    expect(document.querySelectorAll('[role="checkbox"]').length).toBe(0);
  });

  it("offers Restore instead of Delete on an archived family", async () => {
    await render({ family: { ...FAMILY, status: "archived" } });
    expect((await openMenu())()).toEqual(["Edit", "Select", "Restore"]);
  });

  it("shows the statistics: total Sources, median and maximum", async () => {
    await render();
    const stat = document.body.querySelector('[aria-label="Statistics"]')?.textContent ?? "";
    expect(stat).toContain("4Sources");
    expect(stat).not.toContain(" of ");
    expect(text()).toContain("1,500");
    expect(text()).toContain("2,000");
    expect(text()).not.toContain("truncated");
    expect(text()).not.toContain("newest 500");
  });

  it("shows unknown, not zero, when no Source has views", async () => {
    await render({ stats: { sourceCount: 3, withViewsCount: 0, medianViews: null, maxViews: null, truncated: false } });
    expect(document.body.querySelector('[aria-label="Statistics"]')?.textContent).toContain("3Sources");
    expect(document.body.querySelector('[aria-label="Statistics"]')?.textContent).toContain("Unknown");
  });

  it("warns when the statistics cover a truncated sample", async () => {
    await render({ stats: { ...STATS, truncated: true } });
    expect(text()).toContain("newest 500 Sources");
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

  it("shows Sources by default and switches to Recipes with the tabs", async () => {
    await render({ sources: [makeSource()] });
    const tab = (name: string) => [...document.querySelectorAll('[role="tab"]')].find((t) => t.textContent === name) as HTMLElement;
    expect(tab("Sources").getAttribute("aria-selected")).toBe("true");
    expect(document.querySelector('[aria-label="Production Recipes"]')).toBeNull();
    await act(async () => {
      tab("Recipes").click();
    });
    expect(tab("Recipes").getAttribute("aria-selected")).toBe("true");
    expect(document.querySelector('[aria-label="Production Recipes"]')).not.toBeNull();
    expect((document.querySelector('[aria-label="Family Sources"]') as HTMLElement).hidden).toBe(true);
  });
});
