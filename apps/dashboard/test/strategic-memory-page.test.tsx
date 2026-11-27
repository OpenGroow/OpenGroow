/** @vitest-environment jsdom */

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StrategicMemoryContent } from "../src/components/strategic-memory-page";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const useQueryMock = vi.fn();
const usePaginatedQueryMock = vi.fn();
const loadMore = vi.fn();

vi.mock("convex/react", () => ({
  useQuery: (...args: unknown[]) => useQueryMock(...args),
  usePaginatedQuery: (...args: unknown[]) => usePaginatedQueryMock(...args),
}));

vi.mock("@convex/_generated/api", () => ({
  api: {
    strategic_memory: { current: "strategic_memory.current", history: "strategic_memory.history", references: "strategic_memory.references" },
  },
}));

const DAY = Date.UTC(2026, 5, 10, 12);

function makeReview(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    _id: "rev-1",
    periodStart: Date.UTC(2026, 4, 11, 12),
    periodEnd: DAY,
    report: "## Performance\n\nReaction clips led.",
    consolidatedMemory: "## Memory\n\n- Reactions work",
    memoryChanged: true,
    createdAt: DAY,
    ...overrides,
  };
}

const REFERENCES = {
  recipes: [
    { id: "rec-1", name: "Reel recipe" },
    { id: "rec-2", name: "Old mechanic" },
    { id: "rec-3", name: null },
  ],
  publications: [{ id: "pub-1", target: "instagram:example", missionId: "mis-1" }],
};

describe("StrategicMemoryContent", () => {
  let container: HTMLDivElement;
  let root: Root;

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

  async function render({ current, reviews = [], status = "Exhausted" }: { current?: unknown; reviews?: unknown[]; status?: string }) {
    useQueryMock.mockImplementation((key: string) =>
      key === "strategic_memory.current" ? current : key === "strategic_memory.references" ? REFERENCES : undefined,
    );
    usePaginatedQueryMock.mockReturnValue({ results: reviews, status, loadMore });
    await act(async () => {
      root.render(<StrategicMemoryContent instanceId="instance-1" />);
    });
  }

  const text = () => document.body.textContent ?? "";
  const click = async (el: Element | null | undefined) => {
    await act(async () => {
      el?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
  };
  const buttonWith = (label: string) => Array.from(document.querySelectorAll("button")).find((b) => b.textContent?.includes(label));

  it("shows an empty state pointing to the Jobs page when there is no review", async () => {
    await render({ current: null });
    expect(text()).toContain("No Strategic Review yet");
    const link = Array.from(document.querySelectorAll("a")).find((a) => a.textContent?.includes("Jobs"));
    expect(link?.getAttribute("href")).toBe("/projects/instance-1/jobs");
  });

  it("shows the current memory as rendered Markdown with its period and date", async () => {
    await render({ current: makeReview(), reviews: [makeReview()] });
    expect(document.querySelector("section[aria-label='Current memory'] h2")?.textContent).toBe("Memory");
    expect(document.querySelector("section[aria-label='Current memory'] li")?.textContent).toBe("Reactions work");
    expect(text()).toContain("May 11, 2026");
    expect(text()).toContain("Jun 10, 2026");
  });

  it("does not render raw HTML from the memory", async () => {
    const hostile = makeReview({ consolidatedMemory: "Hi <script>window.hacked = 1</script><img src=x onerror=alert(1)>" });
    await render({ current: hostile, reviews: [hostile] });
    expect(document.querySelector("script")).toBeNull();
    expect(document.querySelector("img")).toBeNull();
  });

  it("lists the history in the order received and loads more", async () => {
    await render({
      current: makeReview(),
      reviews: [makeReview({ _id: "rev-2", createdAt: DAY }), makeReview({ _id: "rev-1", createdAt: Date.UTC(2026, 4, 1, 12) })],
      status: "CanLoadMore",
    });
    const entries = document.querySelectorAll("li[data-review]");
    expect(Array.from(entries).map((e) => e.getAttribute("data-review"))).toEqual(["rev-2", "rev-1"]);
    await click(buttonWith("Load more"));
    expect(loadMore).toHaveBeenCalledWith(10);
  });

  it("expands an entry to its report, its memory as it was and its references as links", async () => {
    await render({ current: makeReview(), reviews: [makeReview({ report: "Report body", consolidatedMemory: "Old memory" })] });
    expect(text()).not.toContain("Report body");
    await click(document.querySelector("li[data-review] button[aria-expanded]"));
    expect(text()).toContain("Report body");
    expect(document.querySelector("li[data-review]")?.textContent).toContain("Old memory");
    const hrefs = Array.from(document.querySelectorAll("li[data-review] a")).map((a) => a.getAttribute("href"));
    expect(hrefs).toEqual([
      "/projects/instance-1/recipes/rec-1",
      "/projects/instance-1/recipes/rec-2",
      "/projects/instance-1/missions/mis-1",
    ]);
    expect(text()).toContain("Old mechanic");
    expect(text()).toContain("Deleted");
  });

  it("badges a review that did not change the memory", async () => {
    await render({ current: makeReview(), reviews: [makeReview({ memoryChanged: false })] });
    expect(text()).toContain("Memory unchanged");
  });

  it("does not badge a review that changed the memory", async () => {
    await render({ current: makeReview(), reviews: [makeReview()] });
    expect(text()).not.toContain("Memory unchanged");
  });
});
