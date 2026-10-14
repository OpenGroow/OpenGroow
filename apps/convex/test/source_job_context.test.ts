import { describe, expect, it } from "vitest";
import { buildSourceJobRunFile } from "../source_jobs/source_job_context";

// Issue #579: a chained follow-up execution never normalized the Sources
// awaiting enrichment in its own session, so the run file must carry the
// origin the enrichment job is called with.
describe("buildSourceJobRunFile: Sources awaiting enrichment", () => {
  it("lists each awaiting Source with its origin", () => {
    const file = buildSourceJobRunFile({
      declarations: [],
      batchRunIds: [],
      retrySources: [],
      cursorAt: 0,
      boundAt: 1,
      resumed: true,
      awaitingEnrichment: [
        { id: "src1", sourceId: "instagram-reel", origin: "https://www.instagram.com/reel/AAA/" },
      ],
    });
    expect(file).toContain('- src1 (Source "instagram-reel") — origin: https://www.instagram.com/reel/AAA/');
  });
});

describe("buildSourceJobRunFile: Runs to process", () => {
  const base = { declarations: [], retrySources: [], cursorAt: 0, boundAt: 1 };

  it("gives the report path of a Run whose Mission is known (the agent cannot search for it)", () => {
    const file = buildSourceJobRunFile({ ...base, batchRunIds: ["run1", "run2"], batchRunMissionIds: { run1: "mis1" } });
    expect(file).toContain("- run1 — report: missions/mis1/artifacts/run1/report.json");
    expect(file).toContain("- run2\n");
  });
});

describe("buildSourceJobRunFile: resumed after an enrichment", () => {
  it("gives the stored Source so the agent completes it instead of rebuilding it", () => {
    const file = buildSourceJobRunFile({
      declarations: [],
      batchRunIds: [],
      retrySources: [],
      cursorAt: 0,
      boundAt: 1,
      resumed: true,
      enrichment: {
        sourceRef: "src1",
        sourceId: "instagram-reel",
        output: { status: "completed" },
        stored: {
          origin: "https://www.instagram.com/reel/AAA/",
          capturedAt: 1234,
          marketing: { summary: "s" },
          analysis: { postUrl: "https://www.instagram.com/reel/AAA/", decision: "liked" },
        },
      },
    });
    expect(file).toContain('"capturedAt": 1234');
    expect(file).toContain('"decision": "liked"');
    expect(file).toContain('"status": "completed"');
  });
});
