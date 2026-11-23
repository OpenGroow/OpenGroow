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
  "connections.create": vi.fn(),
  "connections.remove": vi.fn(),
};
let connections: unknown;
let targets: unknown;
let recipes: unknown;
let recipe: unknown;
let versions: unknown;

vi.mock("convex/react", () => ({
  useQuery: (key: string) => (key === "recipes.list" ? recipes : key === "recipes.get" ? recipe : key === "recipes.listVersions" ? versions : key === "connections.list" ? connections : key === "connections.listTargets" ? targets : undefined),
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
    production_connections: {
      create: "connections.create",
      remove: "connections.remove",
      list: "connections.list",
      listTargets: "connections.listTargets",
    },
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
const RECIPE = { _id: "rec-1", creativeFamilyId: "fam-1", name: "Reaction clip", description: "A reaction", status: "active", latest: V2 };

const TARGETS = [
  {
    templateId: "@example/video-demo",
    templateName: "Video Demo",
    missionType: "create_letter_video",
    label: "Letter video",
    selectFields: [
      { key: "format", label: "Format", options: [{ value: "vertical", label: "Vertical" }, { value: "square", label: "Square" }] },
    ],
  },
];
const CONNECTION = {
  _id: "conn-1",
  recipeId: "rec-1",
  templateId: "@example/video-demo",
  missionType: "create_letter_video",
  compatibleWhen: { format: ["vertical"] },
};

describe("Production Recipes UI", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    for (const m of Object.values(mutations)) m.mockReset().mockResolvedValue(null);
    recipes = [];
    connections = [];
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

  it("creates a recipe with prompt and constraints", async () => {
    await act(async () => root.render(<FamilyRecipes instanceId="p1" familyId="fam-1" canCreate />));
    await press("New recipe");
    await fill("#recipe-name", " Reaction clip ");
    await fill("#recipe-description", "A reaction");
    await fill("#recipe-prompt", "Close-up of a woman");
    await fill("#recipe-instructions", "Write a hook");
    await fill("#recipe-constraints", "No dialogue\n\n No text ");
    await submit();
    expect(mutations["recipes.create"]).toHaveBeenCalledWith({
      instanceId: "p1",
      familyId: "fam-1",
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
    await act(async () => root.render(<FamilyRecipes instanceId="p1" familyId="fam-1" canCreate />));
    await press("New recipe");
    await fill("#recipe-name", "R");
    await fill("#recipe-description", "d");
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

  describe("connections panel", () => {
    const panel = () => container.querySelector('[aria-label="Connections"]')!;
    const choose = async (selector: string, value: string) => {
      const select = document.body.querySelector(selector) as HTMLSelectElement;
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(select, value);
        select.dispatchEvent(new Event("change", { bubbles: true }));
      });
    };

    it("lists the connections with target label and conditions", async () => {
      connections = [CONNECTION];
      await act(async () => root.render(<ProductionRecipeContent instanceId="p1" recipeId="rec-1" />));
      expect(panel().textContent).toContain("Video Demo");
      expect(panel().textContent).toContain("Letter video");
      expect(panel().textContent).toContain("Format: Vertical");
    });

    it("creates a connection from an installed target and its option values", async () => {
      await act(async () => root.render(<ProductionRecipeContent instanceId="p1" recipeId="rec-1" />));
      await choose("#connection-target", "0");
      await press("Vertical");
      await press("Add connection");
      expect(mutations["connections.create"]).toHaveBeenCalledWith({
        instanceId: "p1",
        recipeId: "rec-1",
        templateId: "@example/video-demo",
        missionType: "create_letter_video",
        compatibleWhen: { format: ["vertical"] },
      });
    });

    it("tells when no installed Template can consume recipes", async () => {
      targets = [];
      await act(async () => root.render(<ProductionRecipeContent instanceId="p1" recipeId="rec-1" />));
      expect(panel().textContent).toContain("No installed Template");
      expect(Array.from(panel().querySelectorAll("button")).some((b) => b.textContent === "Add connection")).toBe(false);
    });

    it("shows the server error when creating", async () => {
      mutations["connections.create"].mockRejectedValue(new Error("Uncaught Error: This recipe is already connected to this Mission type"));
      await act(async () => root.render(<ProductionRecipeContent instanceId="p1" recipeId="rec-1" />));
      await choose("#connection-target", "0");
      await press("Add connection");
      expect(panel().querySelector('[role="alert"]')?.textContent).toBe("This recipe is already connected to this Mission type");
    });

    it("removes a connection and shows a server refusal", async () => {
      connections = [CONNECTION];
      await act(async () => root.render(<ProductionRecipeContent instanceId="p1" recipeId="rec-1" />));
      const remove = () => act(async () => (panel().querySelector('[aria-label="Remove connection"]') as HTMLElement).click());
      await remove();
      expect(mutations["connections.remove"]).toHaveBeenCalledWith({ instanceId: "p1", connectionId: "conn-1" });
      mutations["connections.remove"].mockRejectedValue(new Error("Uncaught Error: Creative Connection not found"));
      await remove();
      expect(panel().querySelector('[role="alert"]')?.textContent).toBe("Creative Connection not found");
    });
  });
});
