/** @vitest-environment jsdom */

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RecipeProposalReview } from "../src/components/recipe-proposal-review";
import type { Generation } from "../src/components/recipe-generation";

globalThis.PointerEvent ??= MouseEvent as typeof PointerEvent;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const create = vi.fn();
vi.mock("convex/react", () => ({
  useQuery: (key: string) =>
    key === "views.proposalSources" ? [{ sourceId: "src-1", title: "Example source" }] : key === "recipes.listTargets" ? [{ templateId: "@example/video-demo", templateName: "Video Demo", missionType: "make_post", label: "Post" }] : undefined,
  useMutation: () => create,
}));
vi.mock("@convex/_generated/api", () => ({
  api: { production_recipes: { create: "recipes.create", listTargets: "recipes.listTargets" }, recipe_generation_views: { proposalSources: "views.proposalSources" } },
}));
vi.mock("next/link", () => ({ default: ({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) => <a href={href} className={className}>{children}</a> }));

const PROPOSAL = {
  name: "Reaction clip", description: "A reaction", templateId: "@example/video-demo", missionType: "make_post",
  instructions: "Write a hook", constraints: ["short"], sourceIds: ["src-1"], rationale: "It works",
};
const GENERATION: Generation = { generationId: "run-1", runId: "run-1", createdAt: 0, tryCount: 1, state: "ready_to_review", proposal: PROPOSAL };

describe("RecipeProposalReview", () => {
  let container: HTMLDivElement;
  let root: Root;
  const onClose = vi.fn();
  beforeEach(() => {
    create.mockReset().mockResolvedValue(null);
    onClose.mockReset();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });
  const render = (generation: Generation | null) => act(async () => root.render(<RecipeProposalReview instanceId="p1" generation={generation} onClose={onClose} />));
  const submit = () => act(async () => (document.body.querySelector("form") as HTMLFormElement).requestSubmit());

  it("prefills the form and shows the rationale and linked Sources read-only", async () => {
    await render(GENERATION);
    expect((document.body.querySelector("#recipe-name") as HTMLInputElement).value).toBe("Reaction clip");
    expect((document.body.querySelector("#recipe-instructions") as HTMLTextAreaElement).value).toBe("Write a hook");
    expect((document.body.querySelector("#recipe-target") as HTMLSelectElement).value).toBe("0");
    expect(document.body.textContent).toContain("It works");
    expect(document.body.querySelector('a[href="/projects/p1/sources/src-1"]')?.textContent).toBe("Example source");
  });

  it("creates the Recipe from the proposal's Run on save", async () => {
    await render(GENERATION);
    await submit();
    expect(create).toHaveBeenCalledWith({
      instanceId: "p1", templateId: "@example/video-demo", missionType: "make_post", name: "Reaction clip",
      description: "A reaction", instructions: "Write a hook", constraints: ["short"], proposalRunId: "run-1",
    });
  });

  it("shows the server error in the form and creates nothing on cancel", async () => {
    create.mockRejectedValue(new Error("A Production Recipe was already created"));
    await render(GENERATION);
    await submit();
    expect(document.body.querySelector('[role="alert"]')?.textContent).toContain("already created");
    create.mockClear();
    const cancel = Array.from(document.body.querySelectorAll("button")).find((b) => b.textContent?.trim() === "Cancel")!;
    await act(async () => cancel.click());
    expect(create).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it("says a proposal generated from an idea alone cites no Source", async () => {
    await render({ ...GENERATION, proposal: { ...PROPOSAL, sourceIds: [] } });
    expect(document.body.textContent).toContain("Generated from your idea, with no Source");
    expect(document.body.querySelector('a[href^="/projects/p1/sources/"]')).toBeNull();
  });

  it("opens a created proposal read-only with a link to the Recipe", async () => {
    await render({ ...GENERATION, state: "created", recipeId: "rec-1" });
    expect(document.body.querySelector("form")).toBeNull();
    expect(document.body.querySelector('a[href="/projects/p1/recipes/rec-1"]')).not.toBeNull();
    expect(document.body.textContent).toContain("It works");
  });
});
