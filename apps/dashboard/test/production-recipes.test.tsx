/** @vitest-environment jsdom */

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RecipesContent } from "../src/components/recipes-page";
import { ProductionRecipeContent } from "../src/components/production-recipe-page";

globalThis.PointerEvent ??= MouseEvent as typeof PointerEvent;

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mutations: Record<string, ReturnType<typeof vi.fn>> = {
  "recipes.create": vi.fn(),
  "recipes.saveVersion": vi.fn(),
  "recipes.remove": vi.fn(),
  "recipes.setTarget": vi.fn(),
};
const convexQuery = vi.fn();
let targets: unknown;
let recipes: unknown;
let recipe: unknown;
let versions: unknown;
let summary: unknown;

vi.mock("next/navigation", async () => (await import("./fixtures/url-navigation")).navigationMock());
vi.mock("convex/react", () => ({
  usePaginatedQuery: () => ({ results: [], status: "Exhausted", loadMore: () => undefined }),
  useQuery: (key: string) => (key === "recipes.list" ? recipes : key === "recipes.get" ? recipe : key === "recipes.listVersions" ? versions : key === "recipes.listTargets" ? targets : key === "analytics.summary" ? summary : undefined),
  useMutation: (key: string) => mutations[key],
  useConvex: () => ({ query: convexQuery }),
}));
vi.mock("@convex/_generated/api", () => ({
  api: {
    production_recipes: {
      create: "recipes.create",
      saveVersion: "recipes.saveVersion",
      remove: "recipes.remove",
      deletionImpact: "recipes.deletionImpact",
      list: "recipes.list",
      get: "recipes.get",
      listVersions: "recipes.listVersions",
      listTargets: "recipes.listTargets",
      setTarget: "recipes.setTarget",
    },
    recipe_generation: { generateRecipe: "generation.generate" },
    recipe_generation_views: { listGenerations: "generation.list" },
    creative_families: { list: "families.list" },
    sources: { listByInstance: "sources.list" },
    analytics_summary: { summaryForProject: "analytics.summary" },
  },
}));

const V2 = {
  version: 2,
  prompt: "Close-up of a woman",
  instructions: "Write a short hook",
  constraints: ["No dialogue", "No text overlay"],
  createdAt: Date.UTC(2026, 0, 2),
};
const V1 = { ...V2, version: 1, prompt: "Close-up", createdAt: Date.UTC(2026, 0, 1) };
const RECIPE = { _id: "rec-1", templateId: "@example/video-demo", missionType: "create_letter_video", name: "Reaction clip", description: "A reaction", latest: V2 };

const TARGETS = [
  {
    templateId: "@example/video-demo",
    templateName: "Video Demo",
    missionType: "create_letter_video",
    label: "Letter video",
  },
];

describe("Production Recipes UI", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    for (const m of Object.values(mutations)) m.mockReset().mockResolvedValue(null);
    convexQuery.mockReset().mockResolvedValue({ plannedContents: 0 });
    recipes = [];
    summary = { groupBy: "recipe", recipes: [] };
    targets = TARGETS;
    recipe = RECIPE;
    versions = [V2, V1];
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  const press = async (label: string) => {
    const button = Array.from(document.body.querySelectorAll("button")).find((b) => b.textContent?.trim() === label);
    expect(button, `button ${label}`).toBeDefined();
    await act(async () => button!.click());
  };
  const fill = async (selector: string, value: string) => {
    const field = document.body.querySelector(selector) as HTMLInputElement | HTMLTextAreaElement;
    const proto = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    await act(async () => {
      Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(field, value);
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
  };
  const choose = async (selector: string, value: string) => {
    const select = document.body.querySelector(selector) as HTMLSelectElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(select, value);
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
  };
  const submit = async () => {
    await act(async () => (document.body.querySelector("form") as HTMLFormElement).requestSubmit());
  };

  it("lists the recipes of the Project with a link to each", async () => {
    recipes = [{ _id: "rec-1", templateId: "@example/video-demo", missionType: "create_letter_video", name: "Reaction clip", description: "A reaction", latestVersion: 2 }];
    await act(async () => root.render(<RecipesContent instanceId="p1" />));
    expect(container.textContent).toContain("Reaction clip");
    expect(container.textContent).toContain("v2");
    expect(container.textContent).toContain("Video Demo");
    expect(container.textContent).toContain("Letter video");
    expect(container.querySelector("a")?.getAttribute("href")).toBe("/projects/p1/recipes/rec-1");
  });

  const REC = (over: Record<string, unknown>) => ({ _id: "rec-1", createdAt: 1, templateId: "@example/video-demo", missionType: "create_letter_video", name: "Reaction clip", description: "A reaction", latestVersion: 1, ...over });
  const names = () => Array.from(container.querySelectorAll('[aria-label="Production Recipes"] li a')).map((a) => a.textContent);
  const change = async (label: string, value: string) => {
    const select = container.querySelector(`[aria-label="${label}"]`)!.closest('[data-slot="native-select-wrapper"]')!.querySelector("select") as HTMLSelectElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(select, value);
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
  };

  it("shows each recipe on a card with a default cover, its Mission type and its published posts", async () => {
    recipes = [REC({}), REC({ _id: "rec-2", name: "Other", templateId: "@example/video-demo", missionType: "other_video" })];
    summary = { groupBy: "recipe", recipes: [{ recipeId: "rec-1", publications: 19 }] };
    await act(async () => root.render(<RecipesContent instanceId="p1" />));
    expect(container.querySelectorAll('[data-testid="recipe-cover"]')).toHaveLength(2);
    const text = container.textContent!;
    expect(text).toContain("19 posts");
    expect(text).toContain("0 posts");
    expect(text).toContain("Letter video");
    expect(text).toContain("Build a new Recipe");
    expect(container.querySelector('[aria-label="Production Recipes"] h2')?.textContent).toContain("2");
  });

  it("searches, filters by type and sorts the recipes", async () => {
    recipes = [
      REC({ _id: "rec-a", name: "Alpha", createdAt: 1 }),
      REC({ _id: "rec-b", name: "Bravo", createdAt: 3, missionType: "other_video" }),
      REC({ _id: "rec-c", name: "Charlie", createdAt: 2 }),
    ];
    summary = { groupBy: "recipe", recipes: [{ recipeId: "rec-a", publications: 5 }, { recipeId: "rec-c", publications: 9 }] };
    await act(async () => root.render(<RecipesContent instanceId="p1" />));
    expect(names()).toEqual(["Bravo", "Charlie", "Alpha"]);
    await change("Sort recipes", "name");
    expect(names()).toEqual(["Alpha", "Bravo", "Charlie"]);
    await change("Sort recipes", "posts");
    expect(names()).toEqual(["Charlie", "Alpha", "Bravo"]);
    await change("Filter by type", "@example/video-demo::other_video");
    expect(names()).toEqual(["Bravo"]);
    await change("Filter by type", "all");
    const search = container.querySelector('input[aria-label="Search recipes"]') as HTMLInputElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(search, "char");
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(names()).toEqual(["Charlie"]);
  });

  it("opens the creation form from the Build a new Recipe panel", async () => {
    await act(async () => root.render(<RecipesContent instanceId="p1" />));
    await press("Create manually");
    expect(document.body.querySelector("#recipe-name")).not.toBeNull();
  });

  it("creates a recipe with prompt and constraints", async () => {
    await act(async () => root.render(<RecipesContent instanceId="p1" />));
    await press("Create Recipe");
    await fill("#recipe-name", " Reaction clip ");
    await fill("#recipe-description", "A reaction");
    await choose("#recipe-target", "0");
    await fill("#recipe-prompt", "Close-up of a woman");
    await fill("#recipe-instructions", "Write a hook");
    await fill("#recipe-constraints", "No dialogue\n\n No text ");
    await submit();
    expect(mutations["recipes.create"]).toHaveBeenCalledWith({
      instanceId: "p1",
      templateId: "@example/video-demo",
      missionType: "create_letter_video",
      name: "Reaction clip",
      description: "A reaction",
      prompt: "Close-up of a woman",
      instructions: "Write a hook",
      constraints: ["No dialogue", "No text"],
    });
    expect(document.body.querySelector("form")).toBeNull();
  });

  it("shows the server error and keeps the form open", async () => {
    mutations["recipes.create"].mockRejectedValue(new Error("[Request ID: x] Server Error\nUncaught Error: Something went wrong\n    at handler"));
    await act(async () => root.render(<RecipesContent instanceId="p1" />));
    await press("Create Recipe");
    await fill("#recipe-name", "R");
    await fill("#recipe-description", "d");
    await choose("#recipe-target", "0");
    await fill("#recipe-instructions", "i");
    await submit();
    expect(document.body.querySelector('[role="alert"]')?.textContent).toBe("Something went wrong");
    expect(document.body.querySelector("form")).not.toBeNull();
  });

  it("shows the latest version and edits it into a new version", async () => {
    await act(async () => root.render(<ProductionRecipeContent instanceId="p1" recipeId="rec-1" />));
    expect(container.textContent).toContain("Reaction clip");
    expect(container.textContent).toContain("Close-up of a woman");
    expect(container.textContent).toContain("No dialogue");
    await press("Edit");
    expect((document.body.querySelector("#recipe-prompt") as HTMLTextAreaElement).value).toBe("Close-up of a woman");
    expect((document.body.querySelector("#recipe-constraints") as HTMLTextAreaElement).value).toBe("No dialogue\nNo text overlay");
    await fill("#recipe-instructions", "Write a longer hook");
    await submit();
    expect(mutations["recipes.saveVersion"]).toHaveBeenCalledWith({
      instanceId: "p1",
      recipeId: "rec-1",
      prompt: "Close-up of a woman",
      instructions: "Write a longer hook",
      constraints: ["No dialogue", "No text overlay"],
    });
  });

  it("browses the version history", async () => {
    await act(async () => root.render(<ProductionRecipeContent instanceId="p1" recipeId="rec-1" />));
    const items = Array.from(container.querySelectorAll('[aria-label="Version history"] li'));
    expect(items.map((li) => li.textContent)).toEqual([expect.stringContaining("v2"), expect.stringContaining("v1")]);
    await act(async () => (container.querySelector('button[aria-label="Version 1"]') as HTMLElement).click());
    expect(container.textContent).toContain("Viewing version 1");
    expect(container.textContent).toContain("Close-up");
  });

  it("shows the Prompt, Instructions and Constraints as cards with a copy button", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    await act(async () => root.render(<ProductionRecipeContent instanceId="p1" recipeId="rec-1" />));
    for (const title of ["Prompt", "Instructions", "Constraints"]) {
      expect(container.querySelector(`[aria-label="${title}"]`), title).not.toBeNull();
    }
    await act(async () => (container.querySelector('button[aria-label="Copy prompt"]') as HTMLElement).click());
    expect(writeText).toHaveBeenCalledWith(expect.any(String));
    expect(writeText.mock.calls[0]![0].length).toBeGreaterThan(0);
  });

  it("deletes after a confirmation, then returns to the Recipes page", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    await act(async () => root.render(<ProductionRecipeContent instanceId="p1" recipeId="rec-1" />));
    await press("Delete");
    expect(confirm).toHaveBeenCalledWith(expect.not.stringContaining("planned"));
    expect(mutations["recipes.remove"]).not.toHaveBeenCalled();
    confirm.mockReturnValue(true);
    await press("Delete");
    expect(mutations["recipes.remove"]).toHaveBeenCalledWith({ instanceId: "p1", recipeId: "rec-1" });
    confirm.mockRestore();
  });

  it("says how many planned contents not produced yet go with the recipe, and cancels without deleting", async () => {
    convexQuery.mockResolvedValue({ plannedContents: 3 });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    await act(async () => root.render(<ProductionRecipeContent instanceId="p1" recipeId="rec-1" />));
    await press("Delete");
    expect(convexQuery).toHaveBeenCalledWith("recipes.deletionImpact", { instanceId: "p1", recipeId: "rec-1" });
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("3 planned contents that are not produced yet will also be deleted."));
    expect(mutations["recipes.remove"]).not.toHaveBeenCalled();
    confirm.mockRestore();
  });

  it("shows the Mission type of the recipe and changes it", async () => {
    targets = [...TARGETS, { templateId: "@example/video-demo", templateName: "Video Demo", missionType: "other_video", label: "Other video" }];
    await act(async () => root.render(<ProductionRecipeContent instanceId="p1" recipeId="rec-1" />));
    const select = container.querySelector('select[data-slot="native-select"]') as HTMLSelectElement;
    expect(select.selectedOptions[0]?.textContent).toBe("Video Demo · Letter video");
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(select, "1");
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(mutations["recipes.setTarget"]).toHaveBeenCalledWith({ instanceId: "p1", recipeId: "rec-1", templateId: "@example/video-demo", missionType: "other_video" });
  });

  it("asks for a Mission type before creating, and says when none is available", async () => {
    await act(async () => root.render(<RecipesContent instanceId="p1" />));
    await press("Create Recipe");
    await fill("#recipe-name", "R");
    await fill("#recipe-description", "d");
    await fill("#recipe-instructions", "i");
    expect((Array.from(document.body.querySelectorAll("button")).find((b) => b.textContent === "Create recipe") as HTMLButtonElement).disabled).toBe(true);
    expect(mutations["recipes.create"]).not.toHaveBeenCalled();
  });
});
