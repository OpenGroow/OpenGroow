import { describe, expect, it } from "vitest";
import { seoFixtureTemplate } from "./__fixtures__/templates";
import { buildInstallationPlan } from "./installation-plan";
import { ANDROID_TOOL_FIXTURE } from "./__fixtures__/machine-tool";
import type { AgentManifest } from "./types";

const base: AgentManifest = {
  id: "plan-fixture",
  name: "Plan fixture",
  description: "fixture",
  category: "test",
  mcpServers: [],
};

describe("buildInstallationPlan", () => {
  it("lists the hosts of the MCP servers the Agent will call, once each", () => {
    const plan = buildInstallationPlan({
      ...base,
      mcpServers: [
        { name: "a", transport: "streamable-http", url: "https://seo.example.com/mcp" },
        { name: "b", transport: "streamable-http", url: "https://seo.example.com/other" },
        {
          name: "c",
          transport: "streamable-http",
          url: "http://host.docker.internal:4000/mcp",
          activationUrl: "http://localhost:4000/mcp",
        },
      ],
    });
    expect(plan.mcpHosts).toEqual(["seo.example.com", "host.docker.internal:4000", "localhost:4000"]);
  });

  it("lists the secrets the user will be asked for, including those inside groups", () => {
    const plan = buildInstallationPlan({
      ...base,
      requirements: [
        { key: "apiKey", type: "password", label: "API key", required: true },
        { key: "site", type: "url", label: "Site" },
        { type: "group", label: "Account", fields: [{ key: "pwd", type: "password", label: "Password" }] },
      ],
    });
    expect(plan.secrets).toEqual([
      { key: "apiKey", label: "API key", required: true },
      { key: "pwd", label: "Password", required: false },
    ]);
  });

  it("lists the skills installed with the Agent", () => {
    const plan = buildInstallationPlan({ ...base, skills: [{ source: "clawhub", spec: "@owner/skill" }] });
    expect(plan.skills).toEqual(["@owner/skill"]);
  });

  it("is empty for a Template that declares nothing", () => {
    expect(buildInstallationPlan(base)).toEqual({ mcpHosts: [], secrets: [], skills: [], prerequisites: [] });
  });

  it("lists machine-side prerequisites with their minimum version and instructions link", () => {
    const plan = buildInstallationPlan({
      ...base,
      machinePrerequisites: [
        { name: "Tool A", minVersion: "1.2", instructionsUrl: "https://example.com/a" },
        { name: "Tool B", instructionsUrl: "https://example.com/b" },
      ],
    });
    expect(plan.prerequisites).toEqual([
      { name: "Tool A", minVersion: "1.2", instructionsUrl: "https://example.com/a" },
      { name: "Tool B", instructionsUrl: "https://example.com/b" },
    ]);
  });

  it("flags installable prerequisites and shows where they are downloaded from (#726)", () => {
    const plan = buildInstallationPlan({ ...base, machinePrerequisites: [ANDROID_TOOL_FIXTURE] });
    expect(plan.prerequisites).toEqual([
      {
        name: "Android CLI",
        minVersion: "0.1.0",
        instructionsUrl: "https://example.com/android-cli",
        installFrom: "github.com",
      },
    ]);
  });

  it("carries the npm install command and external prerequisites (#736)", () => {
    const external = [{ name: "adb", instructionsUrl: "https://developer.android.com/tools/adb" }];
    const plan = buildInstallationPlan({
      ...base,
      machinePrerequisites: [
        {
          name: "Android CLI",
          minVersion: "0.1.0",
          instructionsUrl: "https://example.com/a",
          installCommand: "npm install -g @acme/some-tool",
          externalPrerequisites: external,
        },
      ],
    });
    expect(plan.prerequisites).toEqual([
      {
        name: "Android CLI",
        minVersion: "0.1.0",
        instructionsUrl: "https://example.com/a",
        installCommand: "npm install -g @acme/some-tool",
        externalPrerequisites: external,
      },
    ]);
  });

  it("describes the SEO fixture Template", () => {
    const plan = buildInstallationPlan(seoFixtureTemplate().manifest);
    expect(plan.secrets.map((s) => s.key)).toEqual(["apiKey"]);
    expect(plan.mcpHosts.length).toBeGreaterThan(0);
  });
});
