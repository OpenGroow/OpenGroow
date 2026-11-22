import { describe, expect, it } from "vitest";
import { placeholdersOf, resolveRecipeVersion, validateRecipeContent } from "../production_recipe_resolver";

const version = {
  prompt: "A close-up, {MOOD} reaction, shot {FRAMING}.",
  instructions: "Write the hook in a {MOOD} tone.",
  constraints: ["No dialogue"],
  variables: [
    { name: "MOOD", values: ["delighted", "curious", "calm"], default: "delighted" },
    { name: "FRAMING", values: ["tight", "wide"], default: "tight" },
  ],
};

describe("resolveRecipeVersion", () => {
  it("uses defaults when nothing is given", () => {
    const r = resolveRecipeVersion(version, {});
    expect(r.prompt).toBe("A close-up, delighted reaction, shot tight.");
    expect(r.instructions).toBe("Write the hook in a delighted tone.");
    expect(r.constraints).toEqual(["No dialogue"]);
    expect(r.values).toEqual({ MOOD: "delighted", FRAMING: "tight" });
  });

  it("prefers an explicit value over default", () => {
    expect(resolveRecipeVersion(version, { values: { MOOD: "calm" } }).values.MOOD).toBe("calm");
  });

  it("draws only the varied variables, from a controlled source", () => {
    const r = resolveRecipeVersion(version, { vary: ["MOOD"], random: () => 0.5 });
    expect(r.values).toEqual({ MOOD: "curious", FRAMING: "tight" });
  });

  it("an explicit value wins over a draw", () => {
    const r = resolveRecipeVersion(version, { values: { MOOD: "calm" }, vary: ["MOOD"], random: () => 0 });
    expect(r.values.MOOD).toBe("calm");
  });

  it("is deterministic and leaves prompt undefined when absent", () => {
    const v = { ...version, prompt: undefined };
    const a = resolveRecipeVersion(v, { vary: ["FRAMING"], random: () => 0.99 });
    expect(a).toEqual(resolveRecipeVersion(v, { vary: ["FRAMING"], random: () => 0.99 }));
    expect(a.prompt).toBeUndefined();
    expect(a.values.FRAMING).toBe("wide");
  });

  it("fails on unknown variables and out-of-list values", () => {
    expect(() => resolveRecipeVersion(version, { values: { TONE: "x" } })).toThrow('Unknown variable "TONE"');
    expect(() => resolveRecipeVersion(version, { vary: ["TONE"] })).toThrow('Unknown variable "TONE"');
    expect(() => resolveRecipeVersion(version, { values: { MOOD: "angry" } })).toThrow('Value "angry" is not allowed for variable "MOOD"');
  });

  it("fails when a variable has no value and no default", () => {
    const v = { ...version, variables: [{ name: "MOOD", values: ["a"] }], prompt: "{MOOD}", instructions: "" };
    expect(() => resolveRecipeVersion(v, {})).toThrow('Variable "MOOD" has no value and no default');
  });
});

describe("validateRecipeContent", () => {
  it("lists placeholders", () => {
    expect(placeholdersOf("a {X} b {Y} {X}")).toEqual(["X", "Y"]);
  });
  it("rejects a placeholder without variable", () => {
    expect(() => validateRecipeContent({ ...version, prompt: "{NOPE}" })).toThrow('Placeholder {NOPE} has no matching variable');
    expect(() => validateRecipeContent({ ...version, instructions: "{NOPE}" })).toThrow("{NOPE}");
  });
  it("rejects a default outside the values", () => {
    const bad = { ...version, variables: [{ name: "MOOD", values: ["a"], default: "b" }] };
    expect(() => validateRecipeContent(bad)).toThrow('Default "b" of variable "MOOD" is not one of its values');
  });
  it("rejects duplicate variables, empty values, bad names", () => {
    expect(() => validateRecipeContent({ ...version, variables: [version.variables[0]!, version.variables[0]!] })).toThrow("declared twice");
    expect(() => validateRecipeContent({ ...version, variables: [{ name: "MOOD", values: [] }] })).toThrow("at least one value");
    expect(() => validateRecipeContent({ ...version, variables: [{ name: "bad name", values: ["a"] }] })).toThrow("Invalid variable name");
  });
  it("accepts a valid version", () => {
    expect(() => validateRecipeContent(version)).not.toThrow();
  });
});
