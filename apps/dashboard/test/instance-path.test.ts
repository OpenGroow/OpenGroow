import { describe, expect, it } from "vitest";
import { runLogsHref, runPromptHref } from "@/src/lib/instance-path";

describe("run deep links", () => {
  it("runLogsHref opens one Run in the Agent's Logs tab", () => {
    expect(runLogsHref("instance-1", "engagement", "run-9")).toBe(
      "/projects/instance-1/agents/engagement/logs?runId=run-9",
    );
  });

  it("runPromptHref opens one Run's prompt for a Mission under the Agent", () => {
    expect(runPromptHref("instance-1", "seo", "run-1", "mission-1")).toBe(
      "/projects/instance-1/agents/seo/prompt?runId=run-1&missionId=mission-1",
    );
  });

  it("encodes path and query segments", () => {
    expect(runLogsHref("a b", "t/x", "r&1")).toBe("/projects/a%20b/agents/t%2Fx/logs?runId=r%261");
  });
});
