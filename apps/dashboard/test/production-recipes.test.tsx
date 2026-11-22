/** @vitest-environment jsdom */

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FamilyRecipes } from "../src/components/family-recipes";
import { ProductionRecipeContent } from "../src/components/production-recipe-page";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mutations: Record<string, ReturnType<typeof vi.fn>> = {
  "recipes.create": vi.fn(),
  "recipes.saveVersion": vi.fn(),
  "recipes.archive": vi.fn(),
  "recipes.unarchive": vi.fn(),
};
let recipes: unknown;
let recipe: unknown;
let versions: unknown;

vi.mock("convex/react", () => ({
  useQuery: (key: string) => (key === "recipes.list" ? recipes : key === "recipes.get" ? recipe : key === "recipes.listVersions" ? versions : undefined),
  useMutation: (key: string) => mutations[key],
}));
vi.mock("@convex/_generated/api", () => ({
  api: {
    production_recipes: {
      create: "recipes.create",
      saveVersion: "recipes.saveVersion",
      archive: "recipes.archive",
      unarchive: "recipes.unarchive",
      list: "recipes.list",
      get: "recipes.get",
      listVersions: "recipes.listVersions",
    },
  },
}));

const V2 = {
  version: 2,
  prompt: "Close-up of {MOOD}",
  instructions: "Write a short hook",
  constraints: ["No dialogue", "No text overlay"],
  variables: [{ name: "MOOD", values: ["delighted", "calm"], default: "calm" }],
  createdAt: Date.UTC(2026, 0, 2),
};
const V1 = { ...V2, version: 1, prompt: "Close-up", variables: [], createdAt: Date.UTC(2026, 0, 1) };
const RECIPE = { _id: "rec-1", creativeFamilyId: "fam-1", name: "Reaction clip", description: "A reaction", status: "active", latest: V2 };

describe("Production Recipes UI", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    for (const m of Object.values(mutations)) m.mockReset().mockResolvedValue(null);
    recipes = [];
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
  const submit = async () => {
    await act(async () => (document.body.querySelector("form") as HTMLFormElement).requestSubmit());
  };

  it("lists the recipes of a family with a link to each", async () => {
    recipes = [{ _id: "rec-1", creativeFamilyId: "fam-1", name: "Reaction clip", description: "A reaction", status: "active", latestVersion: 2 }];
    await act(async () => root.render(<FamilyRecipes instanceId="p1" familyId="fam-1" canCreate />));
    expect(container.textContent).toContain("Reaction clip");
    expect(container.textContent).toContain("v2");
    expect(container.querySelector("a")?.getAttribute("href")).toBe("/projects/p1/library/fam-1/recipes/rec-1");
  });

  it("creates a recipe with prompt, constraints and variables", async () => {
    await act(async () => root.render(<FamilyRecipes instanceId="p1" familyId="fam-1" canCreate />));
    await press("New recipe");
    await fill("#recipe-name", " Reaction clip ");
    await fill("#recipe-description", "A reaction");
    await fill("#recipe-prompt", "Close-up of {MOOD}");
    await fill("#recipe-instructions", "Write a hook");
    await fill("#recipe-constraints", "No dialogue\n\n No text ");
    await press("Add variable");
    await fill("#variable-name-0", "MOOD");
    await fill("#variable-values-0", "delighted\ncalm");
    await fill("#variable-default-0", "calm");
    await submit();
    expect(mutations["recipes.create"]).toHaveBeenCalledWith({
      instanceId: "p1",
      familyId: "fam-1",
      name: "Reaction clip",
      description: "A reaction",
      prompt: "Close-up of {MOOD}",
      instructions: "Write a hook",
      constraints: ["No dialogue", "No text"],
      variables: [{ name: "MOOD", values: ["delighted", "calm"], default: "calm" }],
    });
    expect(document.body.querySelector("form")).toBeNull();
  });

  it("shows the server error and keeps the form open", async () => {
    mutations["recipes.create"].mockRejectedValue(new Error("[Request ID: x] Server Error\nUncaught Error: Placeholder {TYPO} has no matching variable\n    at handler"));
    await act(async () => root.render(<FamilyRecipes instanceId="p1" familyId="fam-1" canCreate />));
    await press("New recipe");
    await fill("#recipe-name", "R");
    await fill("#recipe-description", "d");
    await fill("#recipe-instructions", "i");
    await submit();
    expect(document.body.querySelector('[role="alert"]')?.textContent).toBe("Placeholder {TYPO} has no matching variable");
    expect(document.body.querySelector("form")).not.toBeNull();
  });

  it("shows the latest version and edits it into a new version", async () => {
    await act(async () => root.render(<ProductionRecipeContent instanceId="p1" recipeId="rec-1" />));
    expect(container.textContent).toContain("Reaction clip");
    expect(container.textContent).toContain("Close-up of {MOOD}");
    expect(container.textContent).toContain("No dialogue");
    await press("Edit");
    expect((document.body.querySelector("#recipe-prompt") as HTMLTextAreaElement).value).toBe("Close-up of {MOOD}");
    expect((document.body.querySelector("#recipe-constraints") as HTMLTextAreaElement).value).toBe("No dialogue\nNo text overlay");
    expect((document.body.querySelector("#variable-values-0") as HTMLTextAreaElement).value).toBe("delighted\ncalm");
    await fill("#recipe-instructions", "Write a longer hook");
    await submit();
    expect(mutations["recipes.saveVersion"]).toHaveBeenCalledWith({
      instanceId: "p1",
      recipeId: "rec-1",
      prompt: "Close-up of {MOOD}",
      instructions: "Write a longer hook",
      constraints: ["No dialogue", "No text overlay"],
      variables: [{ name: "MOOD", values: ["delighted", "calm"], default: "calm" }],
    });
  });

  it("shows a server refusal on edit (default outside values)", async () => {
    mutations["recipes.saveVersion"].mockRejectedValue(new Error("Uncaught Error: Default of MOOD is not one of its values"));
    await act(async () => root.render(<ProductionRecipeContent instanceId="p1" recipeId="rec-1" />));
    await press("Edit");
    await fill("#variable-default-0", "angry");
    await submit();
    expect(document.body.querySelector('[role="alert"]')?.textContent).toBe("Default of MOOD is not one of its values");
  });

  it("browses the version history", async () => {
    await act(async () => root.render(<ProductionRecipeContent instanceId="p1" recipeId="rec-1" />));
    const items = Array.from(container.querySelectorAll('[aria-label="Version history"] li'));
    expect(items.map((li) => li.textContent)).toEqual([expect.stringContaining("Version 2"), expect.stringContaining("Version 1")]);
    await press("Version 1");
    expect(container.textContent).toContain("Viewing version 1");
    expect(container.textContent).toContain("Close-up");
  });

  it("archives and unarchives", async () => {
    await act(async () => root.render(<ProductionRecipeContent instanceId="p1" recipeId="rec-1" />));
    await press("Archive");
    expect(mutations["recipes.archive"]).toHaveBeenCalledWith({ instanceId: "p1", recipeId: "rec-1" });
    recipe = { ...RECIPE, status: "archived" };
    await act(async () => root.render(<ProductionRecipeContent instanceId="p1" recipeId="rec-1" />));
    expect(Array.from(container.querySelectorAll("button")).some((b) => b.textContent === "Edit")).toBe(false);
    await press("Unarchive");
    expect(mutations["recipes.unarchive"]).toHaveBeenCalledWith({ instanceId: "p1", recipeId: "rec-1" });
  });
});
