import { describe, it, expect } from "vitest";
import { createInMemoryTemplateRegistry } from "./registry.js";
import { repoPackageTemplate } from "./__fixtures__/templates.js";

// `hello` is the minimal fixture package of the repository (fixtures/packages/hello).
describe("hello fixture package", () => {
  const hello = repoPackageTemplate("hello");

  it("manifest has id 'hello', empty mcpServers, category 'demo'", () => {
    expect(hello.manifest.id).toBe("@opengroow/hello");
    expect(hello.manifest.name).toBe("Hello Agent");
    expect(hello.manifest.category).toBe("demo");
    expect(hello.manifest.mcpServers).toEqual([]);
    expect(hello.manifest.requirements).toBeUndefined();
  });

  it("AGENTS.md instructs to read the run file and write the output JSON", () => {
    expect(hello.agentsMd).toContain("missions/<missionId>/runs/<runId>.md");
    expect(hello.agentsMd).toContain("missions/<missionId>/outputs/<runId>.json");
    expect(hello.agentsMd).toContain('"status": "success"');
    expect(hello.agentsMd).toContain('"summary": "hello from <agentName>"');
  });

  it("is a development Template: listed only when development Templates are enabled", async () => {
    const development = { ...hello, manifest: { ...hello.manifest, visibility: "development" as const } };
    const registry = createInMemoryTemplateRegistry([{ projectId: "p1", template: development }]);
    expect((await registry.list("p1")).map((t) => t.manifest.id)).not.toContain("@opengroow/hello");
    expect((await registry.list("p1", { includeDevelopment: true })).map((t) => t.manifest.id)).toContain("@opengroow/hello");
  });
});
