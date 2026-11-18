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

vi.mock("convex/react", () => ({
  useQuery: (...args: unknown[]) => useQueryMock(...args),
  usePaginatedQuery: (...args: unknown[]) => usePaginatedQueryMock(...args),
  useMutation: () => removeManyMock,
}));

vi.mock("@convex/_generated/api", () => ({
  api: { sources: { listByInstance: "sources.listByInstance", listFamilies: "sources.listFamilies", removeMany: "sources.removeMany" } },
}));

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
    { status = "Exhausted", families }: { status?: string; families?: string[] } = {},
  ) {
    useQueryMock.mockReturnValue(families ?? [...new Set(results.map((r) => r.family as string))].sort());
    usePaginatedQueryMock.mockReturnValue({ results, status, loadMore });
    await act(async () => {
      root.render(<InstanceSourcesContent instanceId="instance-1" />);
    });
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
    expect(text).toContain("social-video");
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

  it("filters by exact status and by agent", async () => {
    await render([
      makeSource({ _id: "a", marketing: { summary: "alpha reel" }, templateId: "@opengroow/seo" }),
      makeSource({ _id: "b", status: "failed", marketing: { summary: "beta reel" }, templateId: "@opengroow/social" }),
    ]);
    await choose(1, "Failed");
    expect(links()).toEqual(["beta reel"]);
    const chip = Array.from(document.querySelectorAll("button")).find((b) => b.textContent === "All")!;
    await act(async () => chip.click());
    await choose(0, "@opengroow/seo");
    expect(links()).toEqual(["alpha reel"]);
  });

  it("treats the Ready chip as every analysed stage", async () => {
    await render([
      makeSource({ _id: "a", marketing: { summary: "alpha reel" }, scoring: { productFit: 1 } }),
      makeSource({ _id: "b", status: "processing", marketing: { summary: "beta reel" } }),
    ]);
    const chip = Array.from(document.querySelectorAll("button")).find((b) => b.textContent === "Ready")!;
    await act(async () => chip.click());
    expect(links()).toEqual(["alpha reel"]);
  });

  it("counts the loaded sources by status", async () => {
    await render([makeSource({ _id: "a" }), makeSource({ _id: "b", status: "failed" })]);
    const tile = (label: string) =>
      Array.from(document.querySelectorAll("[data-slot=stat-tile]")).find((t) => t.textContent?.includes(label))
        ?.textContent;
    expect(tile("Total sources")).toContain("2");
    expect(tile("Failed")).toContain("1");
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

  it("renders every derived normal and terminal pipeline state", async () => {
    await render([
      makeSource({ _id: "a", status: "processing" }),
      makeSource({ _id: "b", status: "ready" }),
      makeSource({ _id: "c", status: "ready", scoring: { productFit: 0.75 } }),
      makeSource({ _id: "d", status: "ready", scoring: { productFit: 0.75 }, selectedAt: 1 }),
      makeSource({
        _id: "e",
        status: "ready",
        scoring: { productFit: 0.75 },
        selectedAt: 1,
        productionMissionId: "mission-1",
      }),
      makeSource({
        _id: "f",
        status: "ready",
        scoring: { productFit: 0.75 },
        selectedAt: 1,
        productionMissionId: "mission-1",
        producedAt: 2,
      }),
      makeSource({
        _id: "g",
        status: "ready",
        scoring: { productFit: 0.75 },
        selectedAt: 1,
        productionMissionId: "mission-1",
        producedAt: 2,
        publishedAt: 3,
      }),
      makeSource({ _id: "h", status: "failed" }),
      makeSource({ _id: "i", status: "unavailable" }),
      makeSource({ _id: "j", status: "ready", excluded: true }),
    ]);
    const text = document.body.textContent ?? "";
    for (const label of [
      "Ingestion",
      "Ready",
      "Scored",
      "Routed",
      "In production",
      "Produced",
      "Published",
      "Failed",
      "Unavailable",
      "Excluded",
    ]) {
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
});
