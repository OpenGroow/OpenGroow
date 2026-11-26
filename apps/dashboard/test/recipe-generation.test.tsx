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
  const tick = async (label: string) => await act(async () => (document.body.querySelector(`[aria-label="${label}"]`) as HTMLElement).click());

  it("needs an idea or a Source, and offers no Source that is not ready", async () => {
    expect(submitButton().disabled).toBe(true);
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
    await tick("Source Summary 2");
    await tick("Family Reaction");
    await act(async () => submitButton().click());
    expect(generate).toHaveBeenCalledWith({ instanceId: "p1", sourceIds: ["src-2"], familyIds: ["fam-1"] });
  });

  it("warns before starting when more than 25 Sources are selected, and does not start", async () => {
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

  it("shows the idea of each generation and offers to review a proposal", async () => {
    generations = { generations: [{ generationId: "run-1", runId: "run-1", createdAt: 0, tryCount: 1, state: "ready_to_review", idea: "A calm reaction", proposal: { name: "x" } }], inFlight: false };
    const onReview = vi.fn();
    await act(async () => root.render(<GenerationHistory instanceId="p1" onReview={onReview} />));
    expect(container.querySelector('[aria-label="Generation History"]')).not.toBeNull();
    expect(container.textContent).toContain("Idea: A calm reaction");
    await act(async () => (Array.from(container.querySelectorAll("button")).find((b) => b.textContent === "Review") as HTMLElement).click());
    expect(onReview).toHaveBeenCalled();
  });
});
