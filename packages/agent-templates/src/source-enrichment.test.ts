import { describe, it, expect } from "vitest";
import { validateManifest } from "./index.js";

// Issue #533, ADR-051: enrichment is a phase of the SourceJob.
const POLLING_CORE = {
  server: "test-mcp",
  mcpTool: "get_status",
  statusField: "status",
  terminalStates: { completed: ["completed"], failed: ["failed"] },
};

const BASE = {
  id: "t",
  name: "T",
  description: "d",
  category: "test",
  mcpServers: [{ name: "test-mcp", transport: "streamable-http", url: "http://x/mcp" }],
  missionTypes: [],
  sources: [
    {
      type: "s",
      label: "S",
      family: "f",
      agentsMd: "sources/s.md",
      analysisSchema: { type: "object", properties: {} },
    },
  ],
};

describe("validateManifest — unavailableErrorCodes", () => {
  it("accepts a string array on a Source's polling block", () => {
    const result = validateManifest({
      ...BASE,
      externalJobsBySource: { s: { analyze: { ...POLLING_CORE, unavailableErrorCodes: ["gone"] } } },
    });
    expect(result.ok).toBe(true);
  });

  it("rejects a malformed value", () => {
    const result = validateManifest({
      ...BASE,
      externalJobsBySource: { s: { analyze: { ...POLLING_CORE, unavailableErrorCodes: "gone" } } },
    });
    expect(result.ok).toBe(false);
  });
});
