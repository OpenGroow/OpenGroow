import { describe, expect, it } from "vitest";
import type { AgentManifest } from "@opengroow/agent-templates";
import { collectTemplateWorkspaceFiles } from "../project_agents/template_workspace_files.js";

const SOURCE = {
  type: "keyword_analysis",
  label: "Keyword analysis",
  family: "search",
  agentsMd: "sources/keyword_analysis.md",
  analysisSchema: { type: "object", properties: { keyword: { type: "string" } } },
};

function manifest(overrides: Partial<AgentManifest> = {}): AgentManifest {
  return {
    id: "t",
    name: "T",
    description: "d",
    category: "demo",
    mcpServers: [],
    missionTypes: [{ type: "do_it", label: "Do it", payload: "{}", agentsMd: "do_it.md" }],
    sources: [SOURCE],
    ...overrides,
  };
}

describe("collectTemplateWorkspaceFiles", () => {
  it("includes AGENTS.md, Mission instruction files and every Source's instruction file", () => {
    const files = collectTemplateWorkspaceFiles({
      agentsMd: "# base",
      manifest: manifest(),
      missionAgentsMd: { do_it: "mission body" },
      sourceInstructions: { keyword_analysis: "source body" },
    });
    expect(Object.fromEntries(files)).toEqual({
      "AGENTS.md": "# base",
      "do_it.md": "mission body",
      "sources/keyword_analysis.md": "source body",
    });
  });

  it("fails activation/refresh with the manifest validation message for an invalid declaration", () => {
    expect(() =>
      collectTemplateWorkspaceFiles({
        agentsMd: "# base",
        manifest: manifest({
          sources: [{ ...SOURCE, analysisSchema: { type: "object", not: { type: "null" } } }],
        }),
        missionAgentsMd: { do_it: "mission body" },
        sourceInstructions: { keyword_analysis: "source body" },
      }),
    ).toThrow(/keyword_analysis.*"not"/);
  });

  it("fails when a Source's instruction file was not loaded", () => {
    expect(() =>
      collectTemplateWorkspaceFiles({
        agentsMd: "# base",
        manifest: manifest(),
        missionAgentsMd: { do_it: "mission body" },
      }),
    ).toThrow(/Source "keyword_analysis".*sources\/keyword_analysis\.md/);
  });

  it("materializes explicit scoring and routing Job instruction files", () => {
    const files = collectTemplateWorkspaceFiles({
      agentsMd: "# base",
      manifest: manifest({
        jobTypes: [
          { type: "source_ingestion", sourceTypes: ["keyword_analysis"] },
          { type: "source_scoring", agentsMd: "jobs/source-scoring.md" },
          { type: "source_routing", agentsMd: "jobs/source-routing.md" },
        ],
      }),
      missionAgentsMd: { do_it: "mission body" },
      sourceInstructions: { keyword_analysis: "source body" },
      jobInstructions: {
        source_scoring: "scoring body",
        source_routing: "routing body",
      },
    });

    expect(files.get("jobs/source-scoring.md")).toBe("scoring body");
    expect(files.get("jobs/source-routing.md")).toBe("routing body");
  });
});

describe("collectTemplateWorkspaceFiles with hidden Mission types (ADR-053)", () => {
  const twoTypes = manifest({
    sources: undefined,
    missionTypes: [
      { type: "do_it", label: "Do it", payload: "{}", agentsMd: "do_it.md" },
      { type: "other", label: "Other", payload: "{}", agentsMd: "other.md" },
    ],
  });
  const template = {
    agentsMd: "# base",
    manifest: twoTypes,
    missionAgentsMd: { do_it: "do body", other: "other body" },
  };

  it("does not carry the instruction file of a hidden Mission type", () => {
    const files = collectTemplateWorkspaceFiles(template, { hiddenMissionTypes: ["other"] });
    expect(Object.fromEntries(files)).toEqual({ "AGENTS.md": "# base", "do_it.md": "do body" });
  });

  it("carries every Mission file when nothing is hidden", () => {
    const expected = { "AGENTS.md": "# base", "do_it.md": "do body", "other.md": "other body" };
    expect(Object.fromEntries(collectTemplateWorkspaceFiles(template))).toEqual(expected);
    expect(Object.fromEntries(collectTemplateWorkspaceFiles(template, { hiddenMissionTypes: [] }))).toEqual(expected);
  });

  it("ignores hidden names the Template does not declare", () => {
    const files = collectTemplateWorkspaceFiles(template, { hiddenMissionTypes: ["removed_type"] });
    expect([...files.keys()].sort()).toEqual(["AGENTS.md", "do_it.md", "other.md"]);
  });
});
