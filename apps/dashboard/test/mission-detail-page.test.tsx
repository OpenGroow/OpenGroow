/** @vitest-environment jsdom */

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MissionDetailContent } from "../src/components/mission-detail-page";
import { useQueryWithTemplates } from "./fixtures/manifests";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const useQueryMock = vi.fn();
const deleteMissionMock = vi.fn();
const retryMissionMock = vi.fn();
const cancelMissionMock = vi.fn();
const routerPushMock = vi.fn();
const routerReplaceMock = vi.fn();

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerPushMock, replace: routerReplaceMock }),
}));

vi.mock("convex/react", () => ({
  useQuery: (...args: unknown[]) => useQueryWithTemplates(useQueryMock)(...args),
  useMutation: (key: string) => (key === "missions.retryMission" ? retryMissionMock : deleteMissionMock),
  useAction: (key: string) => (key === "missions_node.cancelMission" ? cancelMissionMock : vi.fn()),
}));

vi.mock("@convex/_generated/api", () => ({
  api: {
    project_templates: {
      listForProject: "project_templates.listForProject",
      getForProject: "project_templates.getForProject",
    },
    missions: {
      get: "missions.get",
      deleteMission: "missions.deleteMission",
      retryMission: "missions.retryMission",
    },
    missions_node: {
      cancelMission: "missions_node.cancelMission",
    },
    runs: { listByMission: "runs.listByMission" },
    project_agents: { get: "project_agents.get" },
  },
}));

const BASE_MISSION = {
  _id: "mission-1",
  instanceId: "instance-1",
  type: "create_article",
  status: "doing" as const,
  templateId: "@opengroow/seo",
  number: 3,
  name: "My SEO Article",
  summary: "An article about running shoes",
  createdAt: 1700000000000,
  updatedAt: 1700003600000,
};

const FAILED_MISSION = {
  ...BASE_MISSION,
  status: "failed" as const,
  errorMessage: "TIMEOUT: agent did not respond within 30s",
};

const BLOCKED_MISSION = {
  ...BASE_MISSION,
  status: "blocked" as const,
  lastResult: {
    status: "blocked_external" as const,
    summary: "Waiting on human review",
    message: "Your keyword batch needs human validation.",
    blockerCode: "keyword_batch_pending",
    resolution: { kind: "link" as const, url: "https://article-mcp.example.com/review" },
  },
};

const BASE_RUN = {
  _id: "run-1",
  missionId: "mission-1",
  agentName: "seo-agent-v2",
  status: "completed" as const,
  createdAt: 1700000000000,
  completedAt: 1700003600000,
  result: {
    status: "success" as const,
    summary: "Article written successfully",
  },
};

describe("MissionDetailContent", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    useQueryMock.mockReset();
    deleteMissionMock.mockReset();
    deleteMissionMock.mockResolvedValue(undefined);
    retryMissionMock.mockReset();
    retryMissionMock.mockResolvedValue({ runId: "run-retry-new" });
    cancelMissionMock.mockReset();
    cancelMissionMock.mockResolvedValue({ ok: true });
    routerPushMock.mockReset();
    routerReplaceMock.mockReset();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
    document.body.innerHTML = "";
  });

  async function render(instanceId = "instance-1", missionId = "mission-1") {
    await act(async () => {
      root.render(<MissionDetailContent instanceId={instanceId} missionId={missionId} />);
    });
  }

  it("shows loading state while mission is undefined", async () => {
    useQueryMock.mockReturnValue(undefined);
    await render();
    expect(document.body.textContent).toMatch(/loading/i);
  });

  it("shows not-found state when mission is null", async () => {
    useQueryMock.mockImplementation((key: string) => {
      if (key === "missions.get") return null;
      return undefined;
    });
    await render();
    expect(document.body.textContent).toMatch(/not found/i);
  });

  it("shows mission type and number in identity section", async () => {
    useQueryMock.mockImplementation((key: string) => {
      if (key === "missions.get") return BASE_MISSION;
      if (key === "runs.listByMission") return [];
      return undefined;
    });
    await render();
    expect(document.body.textContent).toContain("create_article");
    expect(document.body.textContent).toContain("#3");
  });

  it("shows mission name and summary", async () => {
    useQueryMock.mockImplementation((key: string) => {
      if (key === "missions.get") return BASE_MISSION;
      if (key === "runs.listByMission") return [];
      return undefined;
    });
    await render();
    expect(document.body.textContent).toContain("My SEO Article");
    expect(document.body.textContent).toContain("An article about running shoes");
  });

  it("shows mission status", async () => {
    useQueryMock.mockImplementation((key: string) => {
      if (key === "missions.get") return BASE_MISSION;
      if (key === "runs.listByMission") return [];
      return undefined;
    });
    await render();
    expect(document.body.textContent).toContain("In progress");
  });

  it("shows a From Source badge when mission provenance is present", async () => {
    useQueryMock.mockImplementation((key: string) => {
      if (key === "missions.get") return { ...BASE_MISSION, sourceObservationId: "observation-1" };
      if (key === "runs.listByMission") return [];
      return undefined;
    });

    await render();

    const badge = document.querySelector("[data-testid='from-observation-badge']");
    expect(badge?.textContent).toBe("From Source");
    expect((badge as HTMLAnchorElement | null)?.getAttribute("href")).toBe(
      "/projects/instance-1/sources/observation-1",
    );
  });

  it("shows a Review link for to_validate video missions with artifact.external.id (strict contract)", async () => {
    const mission = {
      ...BASE_MISSION,
      type: "create_video",
      status: "to_validate" as const,
      lastResult: {
        status: "needs_human_review" as const,
        summary: "Video ready",
        reviewQuestions: ["Is the video ready to publish?"],
        artifact: { kind: "video" as const, external: { service: "video-mcp", id: "video-run-1" }, metadata: { runId: "video-run-1" } },
      },
    };
    useQueryMock.mockImplementation((key: string) => {
      if (key === "missions.get") return mission;
      if (key === "runs.listByMission") return [];
      return undefined;
    });
    await render("proj-abc", "mission-video-1");
    const reviewLink = Array.from(document.querySelectorAll("a")).find((a) =>
      a.href.includes("/projects/proj-abc/missions/mission-video-1/review"),
    );
    expect(reviewLink).toBeTruthy();
    expect(reviewLink?.textContent).toContain("Review");
  });

  it("shows Publish and View links for approved video missions with artifact.external.id (strict contract)", async () => {
    const mission = {
      ...BASE_MISSION,
      type: "create_video",
      status: "approved" as const,
      lastResult: {
        status: "needs_human_review" as const,
        summary: "Video ready",
        reviewQuestions: ["Is the video ready to publish?"],
        artifact: { kind: "video" as const, external: { service: "video-mcp", id: "video-run-2" }, metadata: { runId: "video-run-2" } },
      },
    };
    useQueryMock.mockImplementation((key: string) => {
      if (key === "missions.get") return mission;
      if (key === "runs.listByMission") return [];
      return undefined;
    });
    await render("proj-abc", "mission-video-2");
    const publishLink = Array.from(document.querySelectorAll("a")).find((a) =>
      a.href.includes("/projects/proj-abc/missions/mission-video-2/review"),
    );
    expect(publishLink).toBeTruthy();
    expect(publishLink?.textContent).toContain("Publish");

    const viewLink = Array.from(document.querySelectorAll("a")).find((a) =>
      a.href.includes("/projects/proj-abc/missions/mission-video-2/view"),
    );
    expect(viewLink).toBeTruthy();
    expect(viewLink?.textContent).toContain("View");
  });

  it("shows a Review button for to_validate missions with artifact.external.id (strict contract)", async () => {
    const mission = {
      ...BASE_MISSION,
      status: "to_validate" as const,
      lastResult: {
        status: "needs_human_review" as const,
        summary: "Article ready",
        reviewQuestions: [],
        artifact: { kind: "markdown" as const, external: { service: "article-mcp", id: "art-1" }, metadata: {} },
      },
    };
    useQueryMock.mockImplementation((key: string) => {
      if (key === "missions.get") return mission;
      if (key === "runs.listByMission") return [];
      return undefined;
    });
    await render("proj-abc", "mission-ext-1");
    const reviewLink = Array.from(document.querySelectorAll("a")).find((a) =>
      a.href.includes("/projects/proj-abc/missions/mission-ext-1/review"),
    );
    expect(reviewLink).toBeTruthy();
    expect(reviewLink?.textContent).toContain("Review");
    const viewLink = Array.from(document.querySelectorAll("a")).find((a) =>
      a.href.includes("/projects/proj-abc/missions/mission-ext-1/view"),
    );
    expect(viewLink).toBeTruthy();
  });

  it("does NOT show Review link for missions with legacy metadata.runId and no external.id (unmigrated)", async () => {
    const mission = {
      ...BASE_MISSION,
      type: "create_video",
      status: "to_validate" as const,
      lastResult: {
        status: "needs_human_review" as const,
        summary: "Video ready",
        reviewQuestions: [],
        // Legacy shape — no external.id
        artifact: { metadata: { runId: "video-run-legacy" } },
      },
    };
    useQueryMock.mockImplementation((key: string) => {
      if (key === "missions.get") return mission;
      if (key === "runs.listByMission") return [];
      return undefined;
    });
    await render("proj-abc", "mission-legacy");
    const reviewLink = Array.from(document.querySelectorAll("a")).find((a) =>
      a.href.includes("/projects/proj-abc/missions/mission-legacy/review"),
    );
    expect(reviewLink).toBeFalsy();
  });

  it("shows 'What happened' section with error message for failed missions", async () => {
    useQueryMock.mockImplementation((key: string) => {
      if (key === "missions.get") return FAILED_MISSION;
      if (key === "runs.listByMission") return [];
      return undefined;
    });
    await render();
    expect(document.body.textContent).toContain("What happened");
    expect(document.body.textContent).toContain("TIMEOUT: agent did not respond within 30s");
  });

  it("does not show 'What happened' section for non-failed missions", async () => {
    useQueryMock.mockImplementation((key: string) => {
      if (key === "missions.get") return { ...BASE_MISSION, status: "doing" };
      if (key === "runs.listByMission") return [];
      return undefined;
    });
    await render();
    expect(document.body.textContent).not.toContain("What happened");
  });

  it("shows 'What happened' fallback from latest failed run when mission has no errorMessage", async () => {
    const missionNoError = { ...FAILED_MISSION, errorMessage: undefined };
    const failedRun = {
      ...BASE_RUN,
      _id: "run-2",
      status: "failed" as const,
      errorMessage: "Run failed: connection timeout",
    };
    useQueryMock.mockImplementation((key: string) => {
      if (key === "missions.get") return missionNoError;
      if (key === "runs.listByMission") return [failedRun];
      return undefined;
    });
    await render();
    expect(document.body.textContent).toContain("What happened");
    expect(document.body.textContent).toContain("Run failed: connection timeout");
  });

  it("shows 'What happened' from mission.lastResult when an agent completed but reported a failure", async () => {
    // SEO-style failure: the run finishes (status "completed") but reports a failed
    // result, so the detail lives in result/lastResult rather than errorMessage.
    const seoFailure =
      "The SEO MCP server at host.docker.internal:4000 is unreachable (connection refused).";
    const mission = {
      ...FAILED_MISSION,
      errorMessage: undefined,
      lastResult: {
        status: "failed" as const,
        summary: seoFailure,
        error: { code: "MCP_UNREACHABLE", message: seoFailure },
      },
    };
    const completedFailedRun = {
      ...BASE_RUN,
      _id: "run-seo",
      status: "completed" as const,
      result: {
        status: "failed" as const,
        summary: seoFailure,
        error: { code: "MCP_UNREACHABLE", message: seoFailure },
      },
    };
    useQueryMock.mockImplementation((key: string) => {
      if (key === "missions.get") return mission;
      if (key === "runs.listByMission") return [completedFailedRun];
      return undefined;
    });
    await render();
    expect(document.body.textContent).toContain("What happened");
    expect(document.body.textContent).toContain(seoFailure);
    expect(document.body.textContent).not.toContain("Failed; no details recorded");
  });

  it("shows 'What happened' from a completed run's failed result when mission has no error fields", async () => {
    const seoFailure = "The SEO MCP server is unreachable.";
    const mission = { ...FAILED_MISSION, errorMessage: undefined, lastResult: undefined };
    const completedFailedRun = {
      ...BASE_RUN,
      _id: "run-seo",
      status: "completed" as const,
      result: {
        status: "failed" as const,
        summary: seoFailure,
        error: { code: "MCP_UNREACHABLE", message: seoFailure },
      },
    };
    useQueryMock.mockImplementation((key: string) => {
      if (key === "missions.get") return mission;
      if (key === "runs.listByMission") return [completedFailedRun];
      return undefined;
    });
    await render();
    expect(document.body.textContent).toContain("What happened");
    expect(document.body.textContent).toContain(seoFailure);
    expect(document.body.textContent).not.toContain("Failed; no details recorded");
  });

  it("shows 'What happened' with generic fallback when failed mission has no error details at all", async () => {
    const missionNoError = { ...FAILED_MISSION, errorMessage: undefined };
    useQueryMock.mockImplementation((key: string) => {
      if (key === "missions.get") return missionNoError;
      if (key === "runs.listByMission") return [];
      return undefined;
    });
    await render();
    expect(document.body.textContent).toContain("What happened");
    expect(document.body.textContent).toContain("Failed; no details recorded");
  });

  it("shows 'No runs yet' when run history is empty", async () => {
    useQueryMock.mockImplementation((key: string) => {
      if (key === "missions.get") return BASE_MISSION;
      if (key === "runs.listByMission") return [];
      return undefined;
    });
    await render();
    expect(document.body.textContent).toContain("No runs yet");
  });

  it("shows run history with mission name, status, and timestamps", async () => {
    useQueryMock.mockImplementation((key: string) => {
      if (key === "missions.get") return BASE_MISSION;
      if (key === "runs.listByMission") return [BASE_RUN];
      return undefined;
    });
    await render();
    const history = document.body.textContent?.split("Run History")[1] ?? "";
    expect(history).toContain(BASE_MISSION.type);
    expect(history).not.toContain("seo-agent-v2");
    expect(history).toContain("Completed");
  });

  it("shows a View prompt link next to View logs when a workspaceKey is resolved", async () => {
    useQueryMock.mockImplementation((key: string) => {
      if (key === "missions.get") return BASE_MISSION;
      if (key === "runs.listByMission") return [BASE_RUN];
      if (key === "project_agents.get") return { workspaceKey: "workspace-xyz" };
      return undefined;
    });
    await render();
    const links = Array.from(document.querySelectorAll("a")) as HTMLAnchorElement[];
    const viewPromptLink = links.find((a) => a.textContent === "View prompt");
    expect(viewPromptLink).toBeDefined();
    expect(viewPromptLink!.getAttribute("href")).toBe(
      "/projects/instance-1/agents/%40opengroow%2Fseo/prompt?runId=run-1&missionId=mission-1",
    );
  });

  it("shows run result summary in run history", async () => {
    useQueryMock.mockImplementation((key: string) => {
      if (key === "missions.get") return BASE_MISSION;
      if (key === "runs.listByMission") return [BASE_RUN];
      return undefined;
    });
    await render();
    expect(document.body.textContent).toContain("Article written successfully");
  });

  it("shows additional details from a run result", async () => {
    const runWithDetails = {
      ...BASE_RUN,
      result: {
        ...BASE_RUN.result,
        additionalDetails: {
          postsProcessed: 3,
          reportPath: "missions/mission-1/artifacts/run-1/report.json",
        },
      },
    };
    useQueryMock.mockImplementation((key: string) => {
      if (key === "missions.get") return BASE_MISSION;
      if (key === "runs.listByMission") return [runWithDetails];
      return undefined;
    });
    await render();
    expect(document.body.textContent).toContain("Additional details");
    expect(document.body.textContent).toContain("postsProcessed");
    expect(document.body.textContent).toContain("reportPath");
  });

  it("shows run error in run history for failed runs", async () => {
    const failedRun = {
      ...BASE_RUN,
      status: "failed" as const,
      result: undefined,
      errorMessage: "agent crashed",
    };
    useQueryMock.mockImplementation((key: string) => {
      if (key === "missions.get") return BASE_MISSION;
      if (key === "runs.listByMission") return [failedRun];
      return undefined;
    });
    await render();
    expect(document.body.textContent).toContain("agent crashed");
  });

  it("does not show infrastructure details like sessionKey or dispatchCommandId", async () => {
    const runWithInfra = {
      ...BASE_RUN,
      sessionKey: "mega-run-xyz123",
      dispatchCommandId: "cmd-abc",
      instanceId: "instance-1",
    };
    useQueryMock.mockImplementation((key: string) => {
      if (key === "missions.get") return BASE_MISSION;
      if (key === "runs.listByMission") return [runWithInfra];
      return undefined;
    });
    await render();
    expect(document.body.textContent).not.toContain("mega-run-xyz123");
    expect(document.body.textContent).not.toContain("cmd-abc");
  });

  it("shows runs ordered newest first", async () => {
    const olderRun = { ...BASE_RUN, _id: "run-old", createdAt: 1699000000000, result: { ...BASE_RUN.result, summary: "old-summary" } };
    const newerRun = { ...BASE_RUN, _id: "run-new", createdAt: 1701000000000, result: { ...BASE_RUN.result, summary: "new-summary" } };
    useQueryMock.mockImplementation((key: string) => {
      if (key === "missions.get") return BASE_MISSION;
      if (key === "runs.listByMission") return [olderRun, newerRun];
      return undefined;
    });
    await render();
    const text = document.body.textContent ?? "";
    const oldIdx = text.indexOf("old-summary");
    const newIdx = text.indexOf("new-summary");
    expect(newIdx).toBeLessThan(oldIdx);
  });

  it("links back to missions list", async () => {
    useQueryMock.mockImplementation((key: string) => {
      if (key === "missions.get") return BASE_MISSION;
      if (key === "runs.listByMission") return [];
      return undefined;
    });
    await render("proj-abc", "mission-1");
    const links = Array.from(document.querySelectorAll("a"));
    const backLink = links.find((a) => a.href.includes("/projects/proj-abc/missions") && !a.href.includes("/missions/"));
    expect(backLink).toBeTruthy();
  });

  // ── Blocked (external human-review blocker, issue #323) ────────────────────

  it("shows a 'Blocked' status badge, not red, for blocked missions", async () => {
    useQueryMock.mockImplementation((key: string) => {
      if (key === "missions.get") return BLOCKED_MISSION;
      if (key === "runs.listByMission") return [];
      return undefined;
    });
    await render();
    const badge = document.querySelector('[data-slot="status-badge"]');
    expect(badge?.textContent).toBe("Blocked");
    // Amber (warning), never the red of a failure.
    expect(badge?.className).toContain("status-warning");
    expect(badge?.className).not.toContain("status-error");
    expect(document.body.textContent).not.toContain("What happened");
  });

  it("shows the blocked message and a clickable resolution link, not the red failure box", async () => {
    useQueryMock.mockImplementation((key: string) => {
      if (key === "missions.get") return BLOCKED_MISSION;
      if (key === "runs.listByMission") return [];
      return undefined;
    });
    await render();
    expect(document.body.textContent).toContain(
      "Your keyword batch needs human validation.",
    );
    const link = Array.from(document.querySelectorAll("a")).find(
      (a) => a.href === "https://article-mcp.example.com/review",
    );
    expect(link).toBeTruthy();
    expect(link?.target).toBe("_blank");
    // Distinct from the red "What happened" failure box.
    expect(document.querySelector(".bg-red-50")).toBeFalsy();
  });

  it("does not show the blocked section for non-blocked missions", async () => {
    useQueryMock.mockImplementation((key: string) => {
      if (key === "missions.get") return BASE_MISSION;
      if (key === "runs.listByMission") return [];
      return undefined;
    });
    await render();
    expect(document.body.textContent).not.toContain("Open resolution link");
  });

  it("shows a Retry button for blocked missions, like failed missions", async () => {
    useQueryMock.mockImplementation((key: string) => {
      if (key === "missions.get") return BLOCKED_MISSION;
      if (key === "runs.listByMission") return [BASE_RUN];
      return undefined;
    });
    await render();
    const retryBtn = document.body.querySelector("[aria-label='Retry mission']");
    expect(retryBtn).toBeTruthy();
  });

  it("calls retryMission mutation when the Retry button is clicked on a blocked mission", async () => {
    useQueryMock.mockImplementation((key: string) => {
      if (key === "missions.get") return BLOCKED_MISSION;
      if (key === "runs.listByMission") return [BASE_RUN];
      return undefined;
    });
    await render("instance-1", "mission-1");

    const retryBtn = document.body.querySelector("[aria-label='Retry mission']") as HTMLButtonElement;
    expect(retryBtn).toBeTruthy();

    await act(async () => {
      retryBtn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(retryMissionMock).toHaveBeenCalledWith({
      missionId: "mission-1",
      sourceRunId: "run-1",
    });
  });

  // ── Delete control ──────────────────────────────────────────────────────────

  it("shows a delete button on all non-doing statuses", async () => {
    const nonDoingStatuses = ["todo", "to_validate", "approved", "done", "failed"] as const;
    for (const status of nonDoingStatuses) {
      useQueryMock.mockImplementation((key: string) => {
        if (key === "missions.get") return { ...BASE_MISSION, status };
        if (key === "runs.listByMission") return [];
        return undefined;
      });
      await render();
      const btn = document.body.querySelector("[data-delete-mission]");
      expect(btn, `expected delete button for status=${status}`).toBeTruthy();
      // Reset DOM between iterations
      await act(async () => { root.render(<MissionDetailContent instanceId="instance-1" missionId="mission-1" />); });
    }
  });

  it("does not show a delete button when status is doing", async () => {
    useQueryMock.mockImplementation((key: string) => {
      if (key === "missions.get") return { ...BASE_MISSION, status: "doing" };
      if (key === "runs.listByMission") return [];
      return undefined;
    });
    await render();
    const btn = document.body.querySelector("[data-delete-mission]");
    expect(btn).toBeFalsy();
  });

  it("calls deleteMission mutation after confirm=true and redirects to board", async () => {
    vi.spyOn(window, "confirm").mockReturnValueOnce(true);
    useQueryMock.mockImplementation((key: string) => {
      if (key === "missions.get") return { ...BASE_MISSION, status: "todo" };
      if (key === "runs.listByMission") return [];
      return undefined;
    });
    await render("proj-abc", "mission-1");

    const btn = document.body.querySelector("[data-delete-mission]") as HTMLButtonElement;
    expect(btn).toBeTruthy();

    await act(async () => {
      btn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(deleteMissionMock).toHaveBeenCalledWith({ missionId: "mission-1" });
    expect(routerPushMock).toHaveBeenCalledWith("/projects/proj-abc/missions");
  });

  it("does not call deleteMission mutation when confirm=false", async () => {
    vi.spyOn(window, "confirm").mockReturnValueOnce(false);
    useQueryMock.mockImplementation((key: string) => {
      if (key === "missions.get") return { ...BASE_MISSION, status: "todo" };
      if (key === "runs.listByMission") return [];
      return undefined;
    });
    await render();

    const btn = document.body.querySelector("[data-delete-mission]") as HTMLButtonElement;
    await act(async () => {
      btn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(deleteMissionMock).not.toHaveBeenCalled();
    expect(routerPushMock).not.toHaveBeenCalled();
  });

  // ── Stop control ─────────────────────────────────────────────────────────

  it("shows a Stop button only when status is doing", async () => {
    const nonDoingStatuses = [
      "todo",
      "to_validate",
      "approved",
      "done",
      "failed",
      "blocked",
      "cancelled",
    ] as const;
    for (const status of nonDoingStatuses) {
      useQueryMock.mockImplementation((key: string) => {
        if (key === "missions.get") return { ...BASE_MISSION, status };
        if (key === "runs.listByMission") return [];
        return undefined;
      });
      await render();
      const btn = document.body.querySelector("[data-stop-mission]");
      expect(btn, `expected no stop button for status=${status}`).toBeFalsy();
    }

    useQueryMock.mockImplementation((key: string) => {
      if (key === "missions.get") return { ...BASE_MISSION, status: "doing" };
      if (key === "runs.listByMission") return [];
      return undefined;
    });
    await render();
    const btn = document.body.querySelector("[data-stop-mission]");
    expect(btn).toBeTruthy();
  });

  it("does not call cancelMission when the stop confirmation is declined", async () => {
    vi.spyOn(window, "confirm").mockReturnValueOnce(false);
    useQueryMock.mockImplementation((key: string) => {
      if (key === "missions.get") return { ...BASE_MISSION, status: "doing" };
      if (key === "runs.listByMission") return [];
      return undefined;
    });
    await render();

    const btn = document.body.querySelector("[data-stop-mission]") as HTMLButtonElement;
    await act(async () => {
      btn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(cancelMissionMock).not.toHaveBeenCalled();
  });

  it("calls cancelMission after confirm=true without redirecting away from the mission", async () => {
    vi.spyOn(window, "confirm").mockReturnValueOnce(true);
    useQueryMock.mockImplementation((key: string) => {
      if (key === "missions.get") return { ...BASE_MISSION, status: "doing" };
      if (key === "runs.listByMission") return [];
      return undefined;
    });
    await render();

    const btn = document.body.querySelector("[data-stop-mission]") as HTMLButtonElement;
    await act(async () => {
      btn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(cancelMissionMock).toHaveBeenCalledWith({ missionId: "mission-1" });
    expect(routerPushMock).not.toHaveBeenCalled();
  });

  it("surfaces a failed cancelMission call through the shared error-message helper", async () => {
    vi.spyOn(window, "confirm").mockReturnValueOnce(true);
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
    cancelMissionMock.mockRejectedValueOnce(new Error("[CONVEX M(missions_node:cancelMission)] Uncaught Error: Mission is not currently running"));
    useQueryMock.mockImplementation((key: string) => {
      if (key === "missions.get") return { ...BASE_MISSION, status: "doing" };
      if (key === "runs.listByMission") return [];
      return undefined;
    });
    await render();

    const btn = document.body.querySelector("[data-stop-mission]") as HTMLButtonElement;
    await act(async () => {
      btn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(alertSpy).toHaveBeenCalledWith("Mission is not currently running");
  });
});
