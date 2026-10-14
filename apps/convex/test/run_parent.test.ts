import { describe, expect, it } from "vitest";
import type { Id } from "../_generated/dataModel";
import { runParent } from "../run_parent.js";

const RUN_ID = "run_1" as Id<"runs">;
const MISSION_ID = "mission_1" as Id<"missions">;
const GENERIC_JOB_ID = "generic_job_1" as Id<"jobs">;

describe("runParent", () => {
  it("is the Mission for a Run attached to a Mission", () => {
    expect(runParent({ _id: RUN_ID, missionId: MISSION_ID })).toEqual({
      kind: "mission",
      missionId: MISSION_ID,
    });
  });

  it("is the generic Job for a Run attached to a generic Job", () => {
    expect(runParent({ _id: RUN_ID, jobId: GENERIC_JOB_ID })).toEqual({
      kind: "job",
      jobId: GENERIC_JOB_ID,
    });
  });

  it("throws for a Run attached to neither", () => {
    expect(() => runParent({ _id: RUN_ID })).toThrow(/neither a Mission nor a Job/);
  });

  it("rejects a Run attached to a Mission and a generic Job", () => {
    expect(() => runParent({ _id: RUN_ID, missionId: MISSION_ID, jobId: GENERIC_JOB_ID })).toThrow(
      /both a Mission and a Job/,
    );
  });
});
