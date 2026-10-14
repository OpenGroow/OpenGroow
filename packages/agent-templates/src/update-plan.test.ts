import { describe, expect, it } from "vitest";
import { buildUpdatePlan, isNewerVersion, type UpdatePlanSide } from "./update-plan";
import type { AgentManifest } from "./types";

const manifest = (overrides: Partial<AgentManifest> = {}): AgentManifest => ({
  id: "@alice/plan",
  name: "Plan",
  description: "fixture",
  category: "test",
  mcpServers: [],
  ...overrides,
});
const side = (version: string, m: AgentManifest = manifest(), plugins: string[] = []): UpdatePlanSide => ({
  version,
  manifest: m,
  pluginIds: plugins,
});
const types = (...names: string[]) => names.map((type) => ({ type, label: type })) as unknown as AgentManifest["missionTypes"];

describe("buildUpdatePlan", () => {
  it("is empty and flags nothing when the two versions are equivalent", () => {
    const plan = buildUpdatePlan(side("1.0.0"), side("1.1.0"), []);
    expect(plan).toMatchObject({
      fromVersion: "1.0.0",
      toVersion: "1.1.0",
      mcpHosts: { added: [], removed: [], changed: [] },
      newSecrets: [],
      newPlugins: [],
      newSkills: [],
      newRequiredFields: [],
      reactivationFields: [],
      removedMissionTypes: [],
      removedMissionTypesInUse: [],
    });
    expect(plan.requiresAttention).toBe(false);
  });

  it("lists new, removed and changed MCP hosts", () => {
    const from = manifest({
      mcpServers: [
        { name: "main", transport: "streamable-http", url: "https://old.example.com/mcp" },
        { name: "gone", transport: "streamable-http", url: "https://gone.example.com/mcp" },
      ],
    });
    const to = manifest({
      mcpServers: [
        { name: "main", transport: "streamable-http", url: "https://new.example.com/mcp" },
        { name: "extra", transport: "streamable-http", url: "https://extra.example.com/mcp" },
      ],
    });
    const plan = buildUpdatePlan(side("1.0.0", from), side("2.0.0", to), []);
    expect(plan.mcpHosts.added).toEqual(["new.example.com", "extra.example.com"]);
    expect(plan.mcpHosts.removed).toEqual(["old.example.com", "gone.example.com"]);
    expect(plan.mcpHosts.changed).toEqual([{ server: "main", from: ["old.example.com"], to: ["new.example.com"] }]);
    expect(plan.requiresAttention).toBe(true);
  });

  it("lists new secrets, plugins and skills but not ones already installed", () => {
    const from = manifest({
      requirements: [{ key: "apiKey", type: "password", label: "API key", required: true }],
      skills: [{ source: "clawhub", spec: "@a/kept" }],
    });
    const to = manifest({
      requirements: [
        { key: "apiKey", type: "password", label: "API key", required: true },
        { key: "token", type: "password", label: "Token" },
      ],
      skills: [
        { source: "clawhub", spec: "@a/kept" },
        { source: "clawhub", spec: "@a/new" },
      ],
    });
    const plan = buildUpdatePlan(side("1.0.0", from, ["kept-plugin"]), side("1.1.0", to, ["kept-plugin", "new-plugin"]), []);
    expect(plan.newSecrets).toEqual([{ key: "token", label: "Token", required: false }]);
    expect(plan.newPlugins).toEqual(["new-plugin"]);
    expect(plan.newSkills).toEqual(["@a/new"]);
  });

  it("lists fields that become required, and immutable fields that need a re-activation", () => {
    const from = manifest({
      requirements: [
        { key: "site", type: "text", label: "Site" },
        { key: "lang", type: "text", label: "Lang", required: true },
      ],
    });
    const to = manifest({
      requirements: [
        { key: "site", type: "text", label: "Site", required: true },
        { key: "lang", type: "text", label: "Lang", required: true, immutable: true },
        {
          type: "group",
          label: "Brand",
          fields: [{ key: "brand", type: "text", label: "Brand", required: true, immutable: true }],
        },
      ],
    });
    const plan = buildUpdatePlan(side("1.0.0", from), side("1.1.0", to), []);
    expect(plan.newRequiredFields.map((f) => f.key)).toEqual(["site", "brand"]);
    expect(plan.reactivationFields.map((f) => f.key)).toEqual(["lang", "brand"]);
  });

  it("reports removed Mission types, and those a Schedule still uses", () => {
    const from = manifest({ missionTypes: types("a", "b", "c") });
    const to = manifest({ missionTypes: types("a") });
    const plan = buildUpdatePlan(side("1.0.0", from), side("2.0.0", to), ["b", "b", "a"]);
    expect(plan.removedMissionTypes).toEqual(["b", "c"]);
    expect(plan.removedMissionTypesInUse).toEqual([{ type: "b", schedules: 2 }]);
  });
});

describe("isNewerVersion", () => {
  it("compares dotted numeric versions numerically", () => {
    expect(isNewerVersion("0.10.0", "0.9.0")).toBe(true);
    expect(isNewerVersion("1.0.0", "1.0.0")).toBe(false);
    expect(isNewerVersion("1.0.0", "1.2.0")).toBe(false);
  });
  it("treats a version it cannot order as newer when it differs", () => {
    expect(isNewerVersion("nightly-2", "nightly-1")).toBe(true);
    expect(isNewerVersion("nightly-1", "nightly-1")).toBe(false);
  });
});
