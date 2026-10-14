import { describe, it, expect } from "vitest";
import * as packageEntry from "./index.js";
import * as registryModule from "./registry.js";
import { createInMemoryTemplateRegistry } from "./registry.js";
import { repoPackageTemplate } from "./__fixtures__/templates.js";
import type { AgentTemplate } from "./types.js";

const hello = repoPackageTemplate("hello");
const fixture = (id: string, extra: Partial<AgentTemplate["manifest"]> = {}): AgentTemplate => ({
  ...hello,
  manifest: { ...hello.manifest, id, visibility: "production", ...extra },
});

describe("synchronous Template resolution (contract step of #642)", () => {
  it("is not exported by the package entrypoint", () => {
    expect(packageEntry).not.toHaveProperty("getTemplate");
    expect(packageEntry).not.toHaveProperty("listTemplates");
  });

});

// #674: Templates exist only as installed packages. No registry, nor any other
// entry of the registry module, answers for a compiled-in Template or for the
// retired "builtin" version.
describe("no built-in fallback (#674)", () => {
  it("exports no built-in registry and no built-in version", () => {
    expect(Object.keys(registryModule).sort()).toEqual(["createInMemoryTemplateRegistry"]);
  });

  it('never resolves a Template for the retired "builtin" version', async () => {
    const registry = createInMemoryTemplateRegistry([{ projectId: "p1", template: fixture("a"), version: "1.0.0" }]);
    expect(await registry.resolve("p1", "a", "builtin")).toBeUndefined();
  });

  it("does not resolve inherited object keys as Templates", async () => {
    const registry = createInMemoryTemplateRegistry([{ projectId: "p1", template: fixture("a") }]);
    expect(await registry.resolve("p1", "constructor")).toBeUndefined();
    expect(await registry.resolve("p1", "toString")).toBeUndefined();
  });
});

describe("createInMemoryTemplateRegistry", () => {
  it("resolves and lists Templates seeded for a Project, scoped per Project", async () => {
    const a = fixture("a");
    const b = fixture("b");
    const registry = createInMemoryTemplateRegistry([
      { projectId: "p1", template: a },
      { projectId: "p2", template: b },
    ]);
    expect(await registry.resolve("p1", "a")).toBe(a);
    expect(await registry.resolve("p1", "b")).toBeUndefined();
    expect(await registry.list("p2")).toEqual([b]);
    expect(await registry.list("p3")).toEqual([]);
  });

  it("resolves a specific version, or the latest seeded one when none is given", async () => {
    const v1 = fixture("a", { description: "v1" });
    const v2 = fixture("a", { description: "v2" });
    const registry = createInMemoryTemplateRegistry([
      { projectId: "p1", template: v1, version: "1.0.0" },
      { projectId: "p1", template: v2, version: "2.0.0" },
    ]);
    expect(await registry.resolve("p1", "a", "1.0.0")).toBe(v1);
    expect(await registry.resolve("p1", "a")).toBe(v2);
    expect(await registry.resolve("p1", "a", "3.0.0")).toBeUndefined();
    expect(await registry.list("p1")).toEqual([v2]);
  });

  it("hides development Templates from list unless includeDevelopment", async () => {
    const dev = fixture("dev", { visibility: "development" });
    const registry = createInMemoryTemplateRegistry([{ projectId: "p1", template: dev }]);
    expect(await registry.list("p1")).toEqual([]);
    expect(await registry.list("p1", { includeDevelopment: true })).toEqual([dev]);
  });
});
