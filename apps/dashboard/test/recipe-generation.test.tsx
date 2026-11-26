/** @vitest-environment jsdom */

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GenerateRecipeButton, GenerationHistory } from "../src/components/recipe-generation";

globalThis.PointerEvent ??= MouseEvent as typeof PointerEvent;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const generate = vi.fn();
let generations: unknown;
const SOURCES = Array.from({ length: 30 }, (_, i) => ({ _id: `src-${i}`, label: `Source ${i}`, status: "ready", origin: "https://example.com/p", marketing: { summary: `Summary ${i}` } }));
const FAMILIES = [{ _id: "fam-1", name: "Reaction", status: "active", sourceCount: 12, sourceCountCapped: false }];

vi.mock("convex/react", () => ({
  useQuery: (key: string) => (key === "views.list" ? generations : key === "families.list" ? FAMILIES : undefined),
  usePaginatedQuery: () => ({ results: [...SOURCES, { ...SOURCES[0], _id: "src-x", status: "processing" }], status: "Exhausted", loadMore: () => undefined }),
  useMutation: () => generate,
}));
vi.mock("@convex/_generated/api", () => ({
  api: {
    recipe_generation: { generateRecipe: "generation.generate" },
    recipe_generation_views: { listGenerations: "views.list" },
    creative_families: { list: "families.list" },
    sources: { listByInstance: "sources.list" },
  },
}));

describe("Generate Recipe", () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(async () => {
    generate.mockReset().mockResolvedValue({ runId: "run-1" });
    generations = { generations: [], inFlight: false };
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => root.render(<GenerateRecipeButton instanceId="p1" />));
    await act(async () => (container.querySelector("button") as HTMLButtonElement).click());
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  const submitButton = () => Array.from(document.body.querySelectorAll("button")).find((b) => b.getAttribute("type") === "submit") as HTMLButtonElement;
  const type = async (selector: string, value: string) => {
    const field = document.body.querySelector(selector) as HTMLTextAreaElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(field, value);
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
  };
  const openTab = async (name: string) => await act(async () => (Array.from(document.body.querySelectorAll('[role="tab"]')).find((t) => t.textContent === name) as HTMLElement).click());
  const tick = async (label: string) => await act(async () => (document.body.querySelector(`[aria-label="${label}"]`) as HTMLElement).click());

  it("needs an idea or a Source, and offers no Source that is not ready", async () => {
    expect(submitButton().disabled).toBe(true);
    expect(document.body.textContent).toContain("Write an idea or select at least one source");
    await openTab("Sources");
    expect(document.body.querySelector('[aria-label="Source Summary 0"]')).not.toBeNull();
    expect(document.body.querySelectorAll('[aria-label^="Source "]')).toHaveLength(30);
    await type("#generation-idea", "A calm reaction");
    expect(submitButton().disabled).toBe(false);
  });

  it("starts a generation from an idea alone, with no Creative Family and no Source", async () => {
    await type("#generation-idea", " A calm reaction ");
    await act(async () => submitButton().click());
    expect(generate).toHaveBeenCalledWith({ instanceId: "p1", idea: "A calm reaction" });
  });

  it("sends the selected Sources and, as a shortcut, the selected Creative Families", async () => {
    await tick("Family Reaction");
    await openTab("Sources");
    await tick("Source Summary 2");
    expect(document.body.textContent).toContain("2 selected");
    await act(async () => submitButton().click());
    expect(generate).toHaveBeenCalledWith({ instanceId: "p1", sourceIds: ["src-2"], familyIds: ["fam-1"] });
  });

  it("shows the Creative Families first, with their Source count, and searches them", async () => {
    expect(document.body.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe("Creative Families");
    expect(document.body.querySelector('[aria-label="Family Reaction"]')).not.toBeNull();
    expect(document.body.textContent).toContain("12");
    const search = document.body.querySelector('input[aria-label="Search creative families"]') as HTMLInputElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(search, "zzz");
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(document.body.querySelector('[aria-label="Family Reaction"]')).toBeNull();
  });

  it("warns before starting when more than 25 Sources are selected, and does not start", async () => {
    await openTab("Sources");
    for (let i = 0; i < 26; i++) await tick(`Source Summary ${i}`);
    expect(document.body.textContent).toContain("26 Sources are selected, a generation reads at most 25");
    expect(submitButton().disabled).toBe(true);
  });
});

describe("Generation History", () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });
  const render = async (list: unknown[], onReview = vi.fn()) => {
    generations = { generations: list, inFlight: false };
    await act(async () => root.render(<GenerationHistory instanceId="p1" onReview={onReview} />));
    return onReview;
  };
  const button = (name: string) => Array.from(container.querySelectorAll("button")).find((b) => b.textContent?.trim() === name) as HTMLElement | undefined;
  const row = (over: Record<string, unknown>) => ({ generationId: "g", runId: "g", createdAt: 0, tryCount: 1, state: "ready_to_review", ...over });

  it("names a generation by its proposal, offers to review a ready one and to view a created one", async () => {
    const onReview = await render([
      row({ generationId: "g1", state: "ready_to_review", idea: "A calm reaction", proposal: { name: "Calm reaction clip" } }),
      row({ generationId: "g2", state: "created", proposal: { name: "Letter reveal" } }),
    ]);
    expect(container.querySelector('[aria-label="Generation History"]')).not.toBeNull();
    expect(container.textContent).toContain("Calm reaction clip");
    expect(container.textContent).toContain("Ready");
    await act(async () => button("Review")!.click());
    expect(onReview).toHaveBeenCalledWith(expect.objectContaining({ generationId: "g1" }));
    await act(async () => button("View")!.click());
    expect(onReview).toHaveBeenCalledWith(expect.objectContaining({ generationId: "g2" }));
  });

  it("falls back to the idea, and reads why a generation failed under Details", async () => {
    await render([row({ state: "failed", idea: "A letter idea", reason: "Could not read the result file" })]);
    expect(container.textContent).toContain("A letter idea");
    expect(container.textContent).not.toContain("Could not read the result file");
    await act(async () => button("Details")!.click());
    expect(container.textContent).toContain("Could not read the result file");
  });

  it("shows the three latest generations and the rest under View all", async () => {
    await render(Array.from({ length: 5 }, (_, i) => row({ generationId: `g${i}`, state: "created", proposal: { name: `Recipe ${i}` } })));
    expect(container.querySelectorAll("li")).toHaveLength(3);
    await act(async () => button("View all")!.click());
    expect(container.querySelectorAll("li")).toHaveLength(5);
  });

  it("says when there is no generation yet", async () => {
    await render([]);
    expect(container.textContent).toContain("No generation yet");
  });
});
