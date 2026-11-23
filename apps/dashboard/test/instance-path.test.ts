import { describe, expect, it } from "vitest";
import { missionRunHref, runLogsHref } from "@/src/lib/instance-path";

describe("run deep links", () => {
  it("runLogsHref opens one Run in the Agent's Logs tab", () => {
    expect(runLogsHref("instance-1", "engagement", "run-9")).toBe(
      "/projects/instance-1/agents/engagement/logs?runId=run-9",
    );
  });

  it("missionRunHref opens one Run's Prompt or Logs under its Mission", () => {
    expect(missionRunHref("instance-1", "mission-1", "run-1", "prompt")).toBe(
      "/projects/instance-1/missions/mission-1/runs/run-1/prompt",
    );
    expect(missionRunHref("instance-1", "mission-1", "run-1", "logs")).toBe(
      "/projects/instance-1/missions/mission-1/runs/run-1/logs",
    );
  });

  it("encodes path and query segments", () => {
    expect(missionRunHref("a b", "m/1", "r&1", "logs")).toBe("/projects/a%20b/missions/m%2F1/runs/r%261/logs");
    expect(runLogsHref("a b", "t/x", "r&1")).toBe("/projects/a%20b/agents/t%2Fx/logs?runId=r%261");
  });
});
