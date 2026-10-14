/** @vitest-environment jsdom */

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InstanceSourcesContent } from "../src/components/instance-sources-page";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const useQueryMock = vi.fn();
const usePaginatedQueryMock = vi.fn();

vi.mock("convex/react", () => ({
  useQuery: (...args: unknown[]) => useQueryMock(...args),
  usePaginatedQuery: (...args: unknown[]) => usePaginatedQueryMock(...args),
}));

vi.mock("@convex/_generated/api", () => ({
  api: { sources: { listByInstance: "sources.listByInstance", listFamilies: "sources.listFamilies" } },
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
    capturedAt: Date.UTC(2026, 0, 15),
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

  it("filters by family through the paginated query, not client-side", async () => {
    await render([makeSource({ origin: "kw-origin" }), makeSource({ _id: "src-2", family: "social-video" })], {
      families: ["search", "social-video"],
    });
    expect(usePaginatedQueryMock.mock.calls.at(-1)?.[1]).toEqual({ instanceId: "instance-1" });

    const chip = Array.from(document.querySelectorAll("button")).find((b) => b.textContent === "social-video");
    await act(async () => {
      chip!.click();
    });
    expect(usePaginatedQueryMock.mock.calls.at(-1)?.[1]).toEqual({ instanceId: "instance-1", family: "social-video" });

    const all = Array.from(document.querySelectorAll("button")).find((b) => b.textContent === "All");
    await act(async () => {
      all!.click();
    });
    expect(usePaginatedQueryMock.mock.calls.at(-1)?.[1]).toEqual({ instanceId: "instance-1" });
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
});
