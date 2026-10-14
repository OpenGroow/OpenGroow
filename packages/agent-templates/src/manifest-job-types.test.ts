import { describe, expect, it } from "vitest";
import { validateManifest } from "./index.js";

const baseManifest = {
  id: "job-capable",
  name: "Job capable",
  description: "A fixture",
  category: "demo",
  mcpServers: [],
  sources: [
    {
      type: "reel",
      label: "Reel",
      family: "social-video",
      agentsMd: "sources/reel.md",
      analysisSchema: { type: "object" },
    },
  ],
};

describe("validateManifest — explicit Job capabilities", () => {
  it("accepts the three Source-pipeline Job declarations", () => {
    const result = validateManifest({
      ...baseManifest,
      jobTypes: [
        { type: "source_ingestion", sourceTypes: ["reel"] },
        { type: "source_scoring", agentsMd: "jobs/source-scoring.md" },
        { type: "source_routing", agentsMd: "jobs/source-routing.md" },
      ],
    });

    expect(result.ok).toBe(true);
  });

  it("requires source_ingestion to reference declared Source types", () => {
    const result = validateManifest({
      ...baseManifest,
      jobTypes: [{ type: "source_ingestion", sourceTypes: ["unknown"] }],
    });

    expect(result).toMatchObject({ ok: false });
    if (!result.ok) expect(result.reason).toContain('unknown Source type "unknown"');
  });

  it("requires dedicated instruction files for scoring and routing only", () => {
    const result = validateManifest({
      ...baseManifest,
      jobTypes: [{ type: "source_scoring" }, { type: "source_routing" }],
    });

    expect(result).toMatchObject({ ok: false });
    if (!result.ok) expect(result.reason).toContain("agentsMd");
  });

  it("does not require a duplicate instruction file for source ingestion", () => {
    const result = validateManifest({
      ...baseManifest,
      jobTypes: [{ type: "source_ingestion", sourceTypes: ["reel"] }],
    });

    expect(result.ok).toBe(true);
  });

  it("accepts existing manifests without Job declarations", () => {
    expect(validateManifest(baseManifest).ok).toBe(true);
  });

  it("accepts Agent-defined Job capabilities beyond the initial Source pipeline", () => {
    const result = validateManifest({
      ...baseManifest,
      jobTypes: [{ type: "newsletter_digest", agentsMd: "jobs/newsletter-digest.md" }],
    });

    expect(result.ok).toBe(true);
  });

  it("rejects duplicate Job types", () => {
    const result = validateManifest({
      ...baseManifest,
      jobTypes: [
        { type: "source_ingestion", sourceTypes: ["reel"] },
        { type: "source_ingestion", sourceTypes: ["reel"] },
      ],
    });

    expect(result).toMatchObject({ ok: false });
    if (!result.ok) expect(result.reason).toContain("unique");
  });
});
