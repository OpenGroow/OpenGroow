/** @vitest-environment jsdom */

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MissionReviewContent, MissionViewPage } from "../src/components/mission-review-page";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

if (typeof window !== "undefined") {
  window.HTMLFormElement.prototype.requestSubmit = function requestSubmit() {};
}

const useQueryMock = vi.fn();
const useActionMock = vi.fn();
const useMutationMock = vi.fn();
const routerPushMock = vi.fn();
const getReviewMock = vi.fn();
const loadReviewContentMock = vi.fn();
const performReviewActionMock = vi.fn();

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerPushMock }),
}));

vi.mock("convex/react", () => ({
  useQuery: (...args: unknown[]) => useQueryMock(...args),
  useAction: (...args: unknown[]) => useActionMock(...args),
  useMutation: (...args: unknown[]) => useMutationMock(...args),
}));

vi.mock("@convex/_generated/api", () => ({
  api: {
    missions: { get: "missions.get" },
    missions_node: {
      getReview: "missions_node.getReview",
      performReviewAction: "missions_node.performReviewAction",
      loadReviewContent: "missions_node.loadReviewContent",
    },
    instances: { list: "instances.list" },
    project_agents: { get: "project_agents.get" },
    runtime_commands_node: {
      requestWorkspaceFileRead: "runtime_commands_node.requestWorkspaceFileRead",
      getRuntimeCommandResult: "runtime_commands_node.getRuntimeCommandResult",
    },
  },
}));

vi.mock("@/src/lib/auth-client", () => ({
  useSession: () => ({ data: null }),
}));

vi.mock("@/src/components/workspace-markdown", () => ({
  WorkspaceMarkdown: ({ content }: { content: string }) => (
    <div data-testid="markdown">{content}</div>
  ),
}));

// Migrated artifact shape: external.id is the canonical identifier post-#146 migration.
const MISSION_WITH_ARTIFACT = {
  _id: "mission-1",
  instanceId: "instance-1",
  type: "create_article",
  status: "to_validate",
  templateId: "@opengroow/seo",
  createdAt: Date.now(),
  lastResult: {
    status: "needs_human_review",
    summary: "Article ready for review",
    reviewQuestions: ["Does the article match the keyword?"],
    artifact: {
      kind: "markdown",
      external: { service: "article-mcp", id: "art-123" },
      metadata: { keyword: "SEO tips", score: 87 },
    },
  },
};

describe("MissionReviewContent", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    useQueryMock.mockReset();
    useActionMock.mockReset();
    useMutationMock.mockReset();
    routerPushMock.mockReset();
    getReviewMock.mockReset();
    loadReviewContentMock.mockReset();
    performReviewActionMock.mockReset();

    useActionMock.mockImplementation((action: string) => {
      if (action === "missions_node.getReview") {
        return getReviewMock;
      }
      if (action === "missions_node.loadReviewContent") {
        return loadReviewContentMock;
      }
      if (action === "missions_node.performReviewAction") {
        return performReviewActionMock;
      }
      return vi.fn();
    });
    useMutationMock.mockImplementation(() => vi.fn().mockResolvedValue({ runId: "run-1" }));
    getReviewMock.mockImplementation(async () => {
      const mission = useQueryMock("missions.get") as typeof MISSION_WITH_ARTIFACT;
      const artifact = mission?.lastResult?.artifact;
      const kind = artifact?.kind as "markdown" | "metadata" | "image" | "video" | undefined;
      const source = artifact?.external?.service === "workspace" ? "workspace" : "external";
      const isSocial = kind === "metadata" && source === "workspace";
      const actions = isSocial || !artifact
        ? []
        : [
            {
              key: "approve",
              label: kind === "image" ? "Approve and publish" : kind === "video" || mission.type === "internal_linking" ? "Validate" : "Approve",
              requiredStatus: "to_validate",
              inputs: [],
              enabled: mission.status === "to_validate",
            },
            ...(kind === "image"
              ? []
              : [{
                  key: "publish",
                  label: mission.type === "internal_linking" ? "Merge" : "Publish",
                  requiredStatus: "approved",
                  inputs: kind === "video" || (mission.templateId === "@opengroow/seo" && mission.type === "create_article")
                    ? [{ key: "publishDate", label: "Publish date", type: "datetime-local" as const, required: false }]
                    : [],
                  enabled: mission.status === "approved",
                }]),
            {
              key: "reject",
              label: kind === "image" || kind === "video" ? "Reject with feedback" : "Reject",
              requiredStatus: "to_validate",
              inputs: [{ key: "feedback", label: "Review Feedback", type: "text" as const, required: true }],
              enabled: mission.status === "to_validate",
            },
          ];
      return {
        status: mission.status,
        reviewable: mission.status === "to_validate" || mission.status === "approved",
        artifact: {
          available: Boolean(artifact),
          kind,
          externalId: artifact?.external?.id,
          metadata: artifact?.metadata ?? {},
        },
        content: artifact ? { kind: kind ?? "metadata", source, available: true } : null,
        actions,
        errors: artifact ? [] : ["No artifact available for this mission"],
      };
    });

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

  function setupDefaultQuery() {
    useQueryMock.mockImplementation((key: string) => {
      if (key === "missions.get") return MISSION_WITH_ARTIFACT;
      return undefined;
    });
  }

  async function render() {
    await act(async () => {
      root.render(<MissionReviewContent instanceId="instance-1" missionId="mission-1" />);
    });
  }

  async function renderView() {
    await act(async () => {
      root.render(
        <MissionViewPage
          params={Promise.resolve({ instanceId: "instance-1", missionId: "mission-1" })}
        />,
      );
    });
  }

  it("shows keyword and articleId from artifact metadata", async () => {
    setupDefaultQuery();
    loadReviewContentMock.mockReturnValue(new Promise(() => {}));
    await render();

    expect(document.body.textContent).toContain("SEO tips");
    expect(document.body.textContent).toContain("art-123");
  });

  it("renders the cover URL returned by the generic review content loader", async () => {
    setupDefaultQuery();
    loadReviewContentMock.mockResolvedValue({
      kind: "markdown",
      content: "# Article",
      metadata: {},
      coverUrl: "http://localhost:4000/images/art-123/cover",
    });
    await render();
    await act(async () => {});

    const img = document.querySelector('[data-testid="review-cover"]') as HTMLImageElement | null;
    expect(img).not.toBeNull();
    expect(img?.alt).toBe("Cover");
    expect(img?.src).toBe("http://localhost:4000/images/art-123/cover");
  });

  it("shows score from artifact metadata", async () => {
    setupDefaultQuery();
    loadReviewContentMock.mockReturnValue(new Promise(() => {}));
    await render();

    expect(document.body.textContent).toContain("87");
  });

  it("shows RunResult additionalDetails in the Engagement Report", async () => {
    const socialMission = {
      ...MISSION_WITH_ARTIFACT,
      type: "engage",
      templateId: "@opengroow/engagement",
      lastResult: {
        status: "success",
        summary: "Session complete",
        additionalDetails: {
          postsProcessed: 4,
          reportPath: "missions/mission-1/artifacts/run-1/report.json",
        },
        artifact: {
          kind: "metadata",
          external: { service: "workspace", id: "missions/mission-1/artifacts/run-1/report.json" },
        },
      },
    };
    useQueryMock.mockImplementation((key: string) => {
      if (key === "missions.get") return socialMission;
      return undefined;
    });
    loadReviewContentMock.mockResolvedValue({
      kind: "metadata",
      content: JSON.stringify({ summary: { skipped: 1 }, posts: [] }),
      metadata: {},
    });
    await render();
    await act(async () => {});

    expect(document.body.textContent).toContain("Additional details");
    expect(document.body.textContent).toContain("postsProcessed");
    expect(document.body.textContent).toContain("reportPath");
  });

  it("renders an engagement report in read-only view with the current actions object shape", async () => {
    const socialMission = {
      ...MISSION_WITH_ARTIFACT,
      type: "engage",
      templateId: "@opengroow/engagement",
      lastResult: {
        status: "success",
        summary: "Session complete",
        artifact: {
          kind: "metadata",
          external: { service: "workspace", id: "missions/mission-1/artifacts/run-1/report.json" },
        },
      },
    };
    useQueryMock.mockImplementation((key: string) => {
      if (key === "missions.get") return socialMission;
      return undefined;
    });
    loadReviewContentMock.mockResolvedValue({
      kind: "metadata",
      content: JSON.stringify({
        stats: { liked: 1, skipped: 0 },
        posts: [
          {
            postSummary: { accountHandle: "example" },
            agentEvaluation: { decision: "liked" },
            actions: { liked: true, followed: false, commented: false },
          },
        ],
      }),
      metadata: {},
    });

    await renderView();
    await act(async () => {});

    expect(document.body.textContent).toContain("Posts (1)");
    expect(document.body.textContent).toContain("@example");
    expect(document.body.textContent).not.toContain("actions.find");
  });

  it("shows each post's Visual Description, or why the VLM produced none", async () => {
    const socialMission = {
      ...MISSION_WITH_ARTIFACT,
      type: "engage",
      templateId: "@opengroow/engagement",
      lastResult: {
        status: "success",
        summary: "Session complete",
        artifact: {
          kind: "metadata",
          external: { service: "workspace", id: "missions/mission-1/artifacts/run-1/report.json" },
        },
      },
    };
    useQueryMock.mockImplementation((key: string) => {
      if (key === "missions.get") return socialMission;
      return undefined;
    });
    loadReviewContentMock.mockResolvedValue({
      kind: "metadata",
      content: JSON.stringify({
        stats: { liked: 1, skipped: 1 },
        posts: [
          {
            postSummary: { accountHandle: "described" },
            agentEvaluation: { decision: "liked" },
            visualDescription: "Handwritten note: I miss you like crazy",
            visualDescriptionStatus: { ok: true, latencyMs: 2100 },
          },
          {
            postSummary: { accountHandle: "undescribed" },
            agentEvaluation: { decision: "skipped" },
            visualDescriptionStatus: { ok: false, reason: "unreachable", latencyMs: 3 },
          },
        ],
      }),
      metadata: {},
    });

    await renderView();
    await act(async () => {});

    const text = document.body.textContent ?? "";
    expect(text).toContain("Visual description");
    expect(text).toContain("Handwritten note: I miss you like crazy");
    expect(text).toContain("unavailable (unreachable)");
  });

  it("shows jev's scores on each post, or why jev was unavailable", async () => {
    const socialMission = {
      ...MISSION_WITH_ARTIFACT,
      type: "engage",
      templateId: "@opengroow/engagement",
      lastResult: {
        status: "success",
        summary: "Session complete",
        artifact: {
          kind: "metadata",
          external: { service: "workspace", id: "missions/mission-1/artifacts/run-1/report.json" },
        },
      },
    };
    useQueryMock.mockImplementation((key: string) => {
      if (key === "missions.get") return socialMission;
      return undefined;
    });
    loadReviewContentMock.mockResolvedValue({
      kind: "metadata",
      content: JSON.stringify({
        stats: { liked: 1, skipped: 1 },
        posts: [
          {
            postSummary: { accountHandle: "scored" },
            agentEvaluation: { decision: "liked" },
            classifierEvaluation: { status: "available", shouldLikeScore: 0.714, shouldCommentScore: 0.31 },
          },
          {
            postSummary: { accountHandle: "unscored" },
            agentEvaluation: { decision: "skipped" },
            classifierEvaluation: { status: "unavailable", failureReason: "classification_unavailable" },
          },
        ],
      }),
      metadata: {},
    });

    await renderView();
    await act(async () => {});

    const text = document.body.textContent ?? "";
    expect(text).toContain("jev · like 0.71 · comment 0.31");
    expect(text).toContain("jev unavailable (classification_unavailable)");
  });

  it("shows each anchor repair recorded for a post", async () => {
    useQueryMock.mockImplementation((key: string) => {
      if (key === "missions.get") {
        return {
          ...MISSION_WITH_ARTIFACT,
          type: "engage",
          templateId: "@opengroow/engagement",
          lastResult: {
            status: "success",
            summary: "Session complete",
            artifact: {
              kind: "metadata",
              external: { service: "workspace", id: "missions/mission-1/artifacts/run-1/report.json" },
            },
          },
        };
      }
      return undefined;
    });
    loadReviewContentMock.mockResolvedValue({
      kind: "metadata",
      content: JSON.stringify({
        stats: { liked: 1 },
        posts: [
          {
            postSummary: { accountHandle: "repaired" },
            agentEvaluation: { decision: "liked" },
            anchorRepairs: [
              {
                field: "postLikeCountResourceId",
                from: "com.zhiliaoapp.musically:id/g5s",
                to: "com.zhiliaoapp.musically:id/g6s",
                confidence: 0.912,
                outcome: "persisted",
              },
              { field: "postCaptionResourceId", from: null, to: null, confidence: null, outcome: "no_candidate" },
            ],
          },
        ],
      }),
      metadata: {},
    });

    await renderView();
    await act(async () => {});

    const text = document.body.textContent ?? "";
    expect(text).toContain("Anchor repaired · postLikeCountResourceId g5s → g6s (0.91)");
    expect(text).toContain("Anchor repair failed · postCaptionResourceId (no_candidate)");
  });

  it("shows loading state while article content is being fetched", async () => {
    setupDefaultQuery();
    loadReviewContentMock.mockReturnValue(new Promise(() => {}));
    await render();

    expect(document.body.textContent).toMatch(/loading/i);
  });

  it("calls loadReviewContent with the missionId on mount", async () => {
    setupDefaultQuery();
    loadReviewContentMock.mockResolvedValue({ kind: "markdown", content: "# Article", metadata: {} });
    await render();

    await act(async () => {});

    expect(loadReviewContentMock).toHaveBeenCalledWith({ missionId: "mission-1" });
  });

  it("renders article markdown content when loadReviewContent resolves", async () => {
    setupDefaultQuery();
    loadReviewContentMock.mockResolvedValue({ kind: "markdown", content: "# My Article\n\nGreat content here.", metadata: {} });
    await render();

    await act(async () => {});

    const markdownEl = document.querySelector('[data-testid="markdown"]');
    expect(markdownEl).not.toBeNull();
    expect(markdownEl!.textContent).toContain("# My Article");
  });

  it("renders the view page without review or publish actions", async () => {
    setupDefaultQuery();
    loadReviewContentMock.mockResolvedValue({ kind: "markdown", content: "# My Article", metadata: {} });
    await renderView();
    await act(async () => {});

    expect(document.querySelector('[data-testid="markdown"]')?.textContent).toContain("# My Article");
    expect(document.querySelectorAll("button")).toHaveLength(0);
    expect(document.querySelector('[data-testid="review-action-approve"]')).toBeNull();
    expect(document.querySelector('[data-testid="review-action-publish"]')).toBeNull();
  });

  it("shows error when loadReviewContent fails", async () => {
    setupDefaultQuery();
    loadReviewContentMock.mockRejectedValue(new Error("article-mcp unreachable"));
    await render();

    await act(async () => {});

    expect(document.body.textContent).toContain("article-mcp unreachable");
  });

  // ---------------------------------------------------------------------------
  // Generic review action affordances (SEO approve / publish via performReviewAction)
  // ---------------------------------------------------------------------------

  it("shows enabled Approve and Reject buttons (English labels)", async () => {
    setupDefaultQuery();
    loadReviewContentMock.mockReturnValue(new Promise(() => {}));
    performReviewActionMock.mockResolvedValue({ ok: true });
    await render();

    const buttons = Array.from(document.querySelectorAll("button"));
    const approveBtn = buttons.find((b) => b.textContent?.includes("Approve"));
    const rejectBtn = buttons.find((b) => b.textContent?.includes("Reject"));

    expect(approveBtn).toBeTruthy();
    expect(approveBtn?.disabled).toBe(false);
    expect(rejectBtn).toBeTruthy();
    expect(rejectBtn?.disabled).toBe(false);
  });

  it("clicking Reject reveals a feedback textarea", async () => {
    setupDefaultQuery();
    loadReviewContentMock.mockReturnValue(new Promise(() => {}));
    await render();

    expect(document.querySelector("textarea")).toBeNull();

    const rejectBtn = Array.from(document.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Reject"),
    );
    await act(async () => {
      rejectBtn?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(document.querySelector("textarea")).not.toBeNull();
  });

  it("confirm rejection is disabled until feedback is non-empty", async () => {
    setupDefaultQuery();
    loadReviewContentMock.mockReturnValue(new Promise(() => {}));
    await render();

    const rejectBtn = Array.from(document.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Reject"),
    );
    await act(async () => {
      rejectBtn?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const confirmBtn = Array.from(document.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Confirm rejection"),
    );
    expect(confirmBtn?.disabled).toBe(true);

    const textarea = document.querySelector("textarea")!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        "value",
      )!.set!;
      setter.call(textarea, "Make the tone friendlier");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });

    const confirmBtnAfter = Array.from(document.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Confirm rejection"),
    );
    expect(confirmBtnAfter?.disabled).toBe(false);
  });

  it("confirming rejection calls performReviewAction with actionKey reject and feedback", async () => {
    setupDefaultQuery();
    loadReviewContentMock.mockReturnValue(new Promise(() => {}));
    performReviewActionMock.mockResolvedValue({ ok: true });
    await render();

    const rejectBtn = Array.from(document.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Reject"),
    );
    await act(async () => {
      rejectBtn?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const textarea = document.querySelector('[data-testid="reject-feedback"]') as HTMLTextAreaElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        "value",
      )!.set!;
      setter.call(textarea, "Make the tone friendlier");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });

    const confirmBtn = Array.from(document.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Confirm rejection"),
    );
    await act(async () => {
      confirmBtn?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {});

    expect(performReviewActionMock).toHaveBeenCalledWith({
      missionId: "mission-1",
      actionKey: "reject",
      input: { feedback: "Make the tone friendlier" },
    });
    expect(routerPushMock).toHaveBeenCalledWith("/projects/instance-1/missions");
  });

  it("shows error message when rejection via performReviewAction fails", async () => {
    setupDefaultQuery();
    loadReviewContentMock.mockReturnValue(new Promise(() => {}));
    performReviewActionMock.mockImplementation((args: Record<string, unknown>) => {
      if (args.actionKey === "reject") return Promise.reject(new Error("rejection failed"));
      return Promise.resolve({ ok: true });
    });
    await render();

    const rejectBtn = Array.from(document.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Reject"),
    );
    await act(async () => {
      rejectBtn?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const textarea = document.querySelector('[data-testid="reject-feedback"]') as HTMLTextAreaElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        "value",
      )!.set!;
      setter.call(textarea, "Needs work");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });

    const confirmBtn = Array.from(document.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Confirm rejection"),
    );
    await act(async () => {
      confirmBtn?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {});

    expect(document.body.textContent).toContain("rejection failed");
    expect(routerPushMock).not.toHaveBeenCalled();
  });

  it("clicking Approve calls performReviewAction with actionKey 'approve' and redirects", async () => {
    setupDefaultQuery();
    loadReviewContentMock.mockReturnValue(new Promise(() => {}));
    performReviewActionMock.mockResolvedValue({ ok: true });

    await render();

    const approveBtn = Array.from(document.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Approve"),
    );
    await act(async () => {
      approveBtn?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {});

    expect(performReviewActionMock).toHaveBeenCalledWith({
      missionId: "mission-1",
      actionKey: "approve",
    });
    expect(routerPushMock).toHaveBeenCalledWith("/projects/instance-1/missions");
  });

  it("shows error message when performReviewAction fails on approve", async () => {
    setupDefaultQuery();
    loadReviewContentMock.mockReturnValue(new Promise(() => {}));
    performReviewActionMock.mockRejectedValue(new Error("article-mcp unreachable"));

    await render();

    const approveBtn = Array.from(document.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Approve"),
    );
    await act(async () => {
      approveBtn?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {});

    expect(document.body.textContent).toContain("article-mcp unreachable");
    expect(routerPushMock).not.toHaveBeenCalled();
  });

  it("shows only Publish button for approved SEO missions", async () => {
    useQueryMock.mockImplementation((key: string) => {
      if (key === "missions.get") {
        return { ...MISSION_WITH_ARTIFACT, status: "approved" };
      }
      return undefined;
    });
    loadReviewContentMock.mockReturnValue(new Promise(() => {}));
    await render();

    const buttons = Array.from(document.querySelectorAll("button"));
    const publierBtn = buttons.find((b) => b.textContent?.includes("Publish"));
    const approuverBtn = buttons.find((b) => b.textContent?.includes("Approve"));
    // Reject only shown from to_validate
    const rejeterBtn = buttons.find((b) => b.textContent?.includes("Reject"));

    expect(publierBtn).toBeTruthy();
    expect(approuverBtn).toBeFalsy();
    expect(rejeterBtn).toBeFalsy();
    expect(document.querySelector('[data-testid="action-input-publishDate"]')).not.toBeNull();
  });

  it("clicking Publish calls performReviewAction with actionKey 'publish' and redirects", async () => {
    performReviewActionMock.mockResolvedValue({ ok: true });
    useQueryMock.mockImplementation((key: string) => {
      if (key === "missions.get") {
        return { ...MISSION_WITH_ARTIFACT, status: "approved" };
      }
      return undefined;
    });
    loadReviewContentMock.mockReturnValue(new Promise(() => {}));
    await render();

    const publierBtn = Array.from(document.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Publish"),
    );
    await act(async () => {
      publierBtn?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {});

    expect(performReviewActionMock).toHaveBeenCalledWith({
      missionId: "mission-1",
      actionKey: "publish",
    });
    expect(routerPushMock).toHaveBeenCalledWith("/projects/instance-1/missions");
  });

  it("shows error message when performReviewAction fails on publish", async () => {
    useQueryMock.mockImplementation((key: string) => {
      if (key === "missions.get") {
        return { ...MISSION_WITH_ARTIFACT, status: "approved" };
      }
      return undefined;
    });
    loadReviewContentMock.mockReturnValue(new Promise(() => {}));
    performReviewActionMock.mockRejectedValue(new Error("GitHub push failed"));

    await render();

    const publierBtn = Array.from(document.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Publish"),
    );
    await act(async () => {
      publierBtn?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {});

    expect(document.body.textContent).toContain("GitHub push failed");
    expect(routerPushMock).not.toHaveBeenCalled();
  });

  it("shows no-artifact state when lastResult has no artifact", async () => {
    useQueryMock.mockImplementation((key: string) => {
      if (key === "missions.get") {
        return {
          ...MISSION_WITH_ARTIFACT,
          lastResult: {
            status: "needs_human_review",
            summary: "No artifact",
            reviewQuestions: [],
          },
        };
      }
      return undefined;
    });

    await render();

    expect(document.body.textContent).toMatch(/no artifact/i);
  });

  const CAROUSEL_MISSION_TO_VALIDATE = {
    _id: "mission-carousel-1",
    instanceId: "instance-1",
    type: "create_carousel",
    status: "to_validate",
    templateId: "@opengroow/visual-social",
    createdAt: Date.now(),
    lastResult: {
      status: "needs_human_review",
      summary: "Carousel ready for review",
      reviewQuestions: [],
      artifact: {
        kind: "image",
        external: { service: "carousel-mcp", id: "carousel-123" },
        metadata: {},
      },
    },
  };

  it("renders each Carousel slide and platform image from the image review contract", async () => {
    useQueryMock.mockImplementation((key: string) => {
      if (key === "missions.get") return CAROUSEL_MISSION_TO_VALIDATE;
      return undefined;
    });
    loadReviewContentMock.mockResolvedValue({
      kind: "image",
      content: JSON.stringify({
        brief: "Focus tips",
        status: "created",
        platforms: ["instagram", "tiktok"],
        slides: [
          {
            text: "Start with one priority",
            imageUrls: {
              instagram: "http://localhost:4112/media/carousels/carousel-123/instagram/slide-1.png",
              tiktok: "http://localhost:4112/media/carousels/carousel-123/tiktok/slide-1.png",
            },
          },
        ],
      }),
      metadata: {},
    });

    await render();
    await act(async () => {});

    expect(document.querySelector('[data-testid="carousel-review-content"]')).not.toBeNull();
    expect(document.body.textContent).toContain("Start with one priority");
    expect(document.querySelector('[data-testid="carousel-image-1-instagram"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="carousel-image-1-tiktok"]')).not.toBeNull();
  });

  it("approving a Carousel calls the publish effect and completes the review", async () => {
    const performMock = vi.fn().mockResolvedValue({ ok: true });
    useQueryMock.mockImplementation((key: string) => {
      if (key === "missions.get") return CAROUSEL_MISSION_TO_VALIDATE;
      return undefined;
    });
    loadReviewContentMock.mockResolvedValue({
      kind: "image",
      content: JSON.stringify({
        platforms: ["instagram"],
        slides: [{ text: "Start", imageUrls: { instagram: "http://localhost:4112/media/slide-1.png" } }],
      }),
      metadata: {},
    });
    useActionMock.mockImplementation((action: string) => {
      if (action === "missions_node.getReview") return getReviewMock;
      if (action === "missions_node.loadReviewContent") return loadReviewContentMock;
      if (action === "missions_node.performReviewAction") return performMock;
      return vi.fn();
    });

    await render();
    await act(async () => {});

    const approveButton = Array.from(document.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("Approve and publish"),
    );
    expect(approveButton).toBeTruthy();
    await act(async () => {
      approveButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {});

    expect(performMock).toHaveBeenCalledWith({ missionId: "mission-1", actionKey: "approve" });
    expect(routerPushMock).toHaveBeenCalledWith("/projects/instance-1/missions");
  });

  it("blocks approval and explains missing platform variants", async () => {
    useQueryMock.mockImplementation((key: string) => {
      if (key === "missions.get") return CAROUSEL_MISSION_TO_VALIDATE;
      return undefined;
    });
    loadReviewContentMock.mockResolvedValue({
      kind: "image",
      content: JSON.stringify({
        platforms: ["instagram", "tiktok"],
        slides: [{ text: "Start", imageUrls: { instagram: "http://localhost:4112/media/slide-1.png" } }],
      }),
      metadata: {},
    });

    await render();
    await act(async () => {});

    expect(document.querySelector('[data-testid="carousel-missing-images"]')?.textContent).toContain("tiktok");
    expect((document.querySelector('[data-testid="review-action-approve"]') as HTMLButtonElement).disabled).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // Video template branch — generic review path (ADR-020)
  // Video content is loaded via loadReviewContent returning { kind: "video",
  // content: <url> }. The generic renderer shows <video data-testid="review-video">.
  // ---------------------------------------------------------------------------

  const VIDEO_MISSION_TO_VALIDATE = {
    _id: "mission-video-1",
    instanceId: "instance-1",
    type: "create_video",
    status: "to_validate",
    templateId: "@opengroow/video-demo",
    createdAt: Date.now(),
    lastResult: {
      status: "needs_human_review",
      summary: "Video ready for review",
      reviewQuestions: [],
      artifact: {
        kind: "video",
        external: { service: "video-mcp", id: "run-uuid-video-1" },
        metadata: { runId: "run-uuid-video-1" },
      },
    },
  };

  it("renders <video> element via generic renderer for video mission in to_validate", async () => {
    useQueryMock.mockImplementation((key: string) => {
      if (key === "missions.get") return VIDEO_MISSION_TO_VALIDATE;
      return undefined;
    });
    loadReviewContentMock.mockResolvedValue({
      kind: "video",
      content: "https://video-mcp.test/videos/run-uuid-video-1/final",
      metadata: { runId: "run-uuid-video-1" },
    });

    await render();
    await act(async () => {});

    const videoEl = document.querySelector('[data-testid="review-video"]');
    expect(videoEl).not.toBeNull();
    expect(videoEl?.getAttribute("src")).toBe("https://video-mcp.test/videos/run-uuid-video-1/final");
    expect(loadReviewContentMock).toHaveBeenCalledWith({ missionId: "mission-1" });
  });

  it("shows Validate button for video mission in to_validate (label from template)", async () => {
    useQueryMock.mockImplementation((key: string) => {
      if (key === "missions.get") return VIDEO_MISSION_TO_VALIDATE;
      return undefined;
    });
    loadReviewContentMock.mockReturnValue(new Promise(() => {}));

    await render();

    const buttons = Array.from(document.querySelectorAll("button"));
    const validateBtn = buttons.find((b) => b.textContent?.includes("Validate"));
    expect(validateBtn).toBeTruthy();
  });

  it("Validate button calls performReviewAction with approve actionKey and redirects", async () => {
    useQueryMock.mockImplementation((key: string) => {
      if (key === "missions.get") return VIDEO_MISSION_TO_VALIDATE;
      return undefined;
    });
    loadReviewContentMock.mockReturnValue(new Promise(() => {}));
    performReviewActionMock.mockResolvedValue({ ok: true });

    await render();
    await act(async () => {});

    const validateBtn = Array.from(document.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Validate"),
    );
    await act(async () => {
      validateBtn?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {});

    expect(performReviewActionMock).toHaveBeenCalledWith({
      missionId: "mission-1",
      actionKey: "approve",
    });
    expect(routerPushMock).toHaveBeenCalledWith("/projects/instance-1/missions");
  });

  it("renders <video> via generic renderer for approved video mission", async () => {
    useQueryMock.mockImplementation((key: string) => {
      if (key === "missions.get") {
        return { ...VIDEO_MISSION_TO_VALIDATE, status: "approved" };
      }
      return undefined;
    });
    loadReviewContentMock.mockResolvedValue({
      kind: "video",
      content: "https://video-mcp.test/videos/run-uuid-video-1/final",
      metadata: { runId: "run-uuid-video-1" },
    });
    performReviewActionMock.mockResolvedValue({ ok: true });

    await render();
    await act(async () => {});

    const videoEl = document.querySelector('[data-testid="review-video"]');
    expect(videoEl).not.toBeNull();

    // shows Publish button, not Validate
    const publishBtn = Array.from(document.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Publish"),
    );
    expect(publishBtn).toBeTruthy();
  });

  it("does NOT render <video> for non-video template (seo) even with to_validate status", async () => {
    useQueryMock.mockImplementation((key: string) => {
      if (key === "missions.get") return MISSION_WITH_ARTIFACT; // templateId: "@opengroow/seo", status: "to_validate"
      return undefined;
    });
    loadReviewContentMock.mockReturnValue(new Promise(() => {}));

    await render();

    const videoEl = document.querySelector('[data-testid="review-video"]');
    expect(videoEl).toBeNull();
  });

  // ---------------------------------------------------------------------------
  // Video publish affordance (approved status) — generic performReviewAction
  // ---------------------------------------------------------------------------

  const VIDEO_MISSION_APPROVED = {
    _id: "mission-video-1",
    instanceId: "instance-1",
    type: "create_video",
    status: "approved",
    templateId: "@opengroow/video-demo",
    createdAt: Date.now(),
    lastResult: {
      status: "needs_human_review",
      summary: "Video approved",
      reviewQuestions: [],
      artifact: {
        kind: "video",
        external: { service: "video-mcp", id: "run-uuid-video-1" },
        metadata: { runId: "run-uuid-video-1" },
      },
    },
  };

  it("shows Publish button (not Validate) for approved video mission", async () => {
    useQueryMock.mockImplementation((key: string) => {
      if (key === "missions.get") return VIDEO_MISSION_APPROVED;
      return undefined;
    });
    loadReviewContentMock.mockReturnValue(new Promise(() => {}));
    performReviewActionMock.mockResolvedValue({ ok: true });

    await render();
    await act(async () => {});

    const buttons = Array.from(document.querySelectorAll("button"));
    const publishBtn = buttons.find((b) => b.textContent?.includes("Publish"));
    const validateBtn = buttons.find((b) => b.textContent?.includes("Validate"));
    expect(publishBtn).toBeTruthy();
    expect(validateBtn).toBeFalsy();
  });

  it("shows optional publish-date input for approved video mission", async () => {
    useQueryMock.mockImplementation((key: string) => {
      if (key === "missions.get") return VIDEO_MISSION_APPROVED;
      return undefined;
    });
    loadReviewContentMock.mockReturnValue(new Promise(() => {}));
    performReviewActionMock.mockResolvedValue({ ok: true });

    await render();
    await act(async () => {});

    const dateInput = document.querySelector('[data-testid="action-input-publishDate"]');
    expect(dateInput).not.toBeNull();
  });

  it("clicking Publish calls performReviewAction with publish actionKey without date when empty", async () => {
    const performMock = vi.fn().mockResolvedValue({ ok: true });
    useQueryMock.mockImplementation((key: string) => {
      if (key === "missions.get") return VIDEO_MISSION_APPROVED;
      return undefined;
    });
    loadReviewContentMock.mockReturnValue(new Promise(() => {}));
    useActionMock.mockImplementation((action: string) => {
      if (action === "missions_node.getReview") return getReviewMock;
      if (action === "missions_node.loadReviewContent") return loadReviewContentMock;
      if (action === "missions_node.performReviewAction") return performMock;
      return vi.fn();
    });

    await render();
    await act(async () => {});

    const publishBtn = Array.from(document.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Publish"),
    );
    await act(async () => {
      publishBtn?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {});

    // No input provided — should call without input field or with empty
    expect(performMock).toHaveBeenCalledWith(
      expect.objectContaining({ missionId: "mission-1", actionKey: "publish" }),
    );
    expect(routerPushMock).toHaveBeenCalledWith("/projects/instance-1/missions");
  });

  it("clicking Publish passes publishDate when date input is filled", async () => {
    const performMock = vi.fn().mockResolvedValue({ ok: true });
    useQueryMock.mockImplementation((key: string) => {
      if (key === "missions.get") return VIDEO_MISSION_APPROVED;
      return undefined;
    });
    loadReviewContentMock.mockReturnValue(new Promise(() => {}));
    useActionMock.mockImplementation((action: string) => {
      if (action === "missions_node.getReview") return getReviewMock;
      if (action === "missions_node.loadReviewContent") return loadReviewContentMock;
      if (action === "missions_node.performReviewAction") return performMock;
      return vi.fn();
    });

    await render();
    await act(async () => {});

    const dateInput = document.querySelector('[data-testid="action-input-publishDate"]') as HTMLInputElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      )!.set!;
      setter.call(dateInput, "2026-06-15T10:00");
      dateInput.dispatchEvent(new Event("input", { bubbles: true }));
    });

    const publishBtn = Array.from(document.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Publish"),
    );
    await act(async () => {
      publishBtn?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {});

    expect(performMock).toHaveBeenCalledWith({
      missionId: "mission-1",
      actionKey: "publish",
      input: { publishDate: "2026-06-15T10:00" },
    });
  });

  it("shows error message when performReviewAction fails for approved video publish", async () => {
    useQueryMock.mockImplementation((key: string) => {
      if (key === "missions.get") return VIDEO_MISSION_APPROVED;
      return undefined;
    });
    loadReviewContentMock.mockReturnValue(new Promise(() => {}));
    performReviewActionMock.mockRejectedValue(new Error("no scheduler channel configured"));

    await render();
    await act(async () => {});

    const publishBtn = Array.from(document.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Publish"),
    );
    await act(async () => {
      publishBtn?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {});

    expect(document.body.textContent).toContain("no scheduler channel configured");
    expect(routerPushMock).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // Video reject with feedback affordance (to_validate status)
  // ---------------------------------------------------------------------------

  it("shows Validate and Reject-with-feedback buttons for video mission in to_validate", async () => {
    useQueryMock.mockImplementation((key: string) => {
      if (key === "missions.get") return VIDEO_MISSION_TO_VALIDATE;
      return undefined;
    });
    loadReviewContentMock.mockReturnValue(new Promise(() => {}));

    await render();

    const buttons = Array.from(document.querySelectorAll("button"));
    const validateBtn = buttons.find((b) => b.textContent?.includes("Validate"));
    const rejectBtn = buttons.find((b) => b.textContent?.includes("Reject with feedback"));
    expect(validateBtn).toBeTruthy();
    expect(rejectBtn).toBeTruthy();
  });

  it("clicking Reject-with-feedback reveals a feedback textarea", async () => {
    useQueryMock.mockImplementation((key: string) => {
      if (key === "missions.get") return VIDEO_MISSION_TO_VALIDATE;
      return undefined;
    });
    loadReviewContentMock.mockReturnValue(new Promise(() => {}));

    await render();

    expect(document.querySelector('[data-testid="reject-feedback"]')).toBeNull();

    const rejectBtn = Array.from(document.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Reject with feedback"),
    );
    await act(async () => {
      rejectBtn?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(document.querySelector('[data-testid="reject-feedback"]')).not.toBeNull();
  });

  it("confirm video rejection is disabled until feedback is non-empty", async () => {
    useQueryMock.mockImplementation((key: string) => {
      if (key === "missions.get") return VIDEO_MISSION_TO_VALIDATE;
      return undefined;
    });
    loadReviewContentMock.mockReturnValue(new Promise(() => {}));

    await render();

    const rejectBtn = Array.from(document.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Reject with feedback"),
    );
    await act(async () => {
      rejectBtn?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const confirmBtn = Array.from(document.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Confirm rejection"),
    );
    expect(confirmBtn?.disabled).toBe(true);

    const textarea = document.querySelector('[data-testid="reject-feedback"]') as HTMLTextAreaElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        "value",
      )!.set!;
      setter.call(textarea, "The pacing is too fast");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });

    const confirmBtnAfter = Array.from(document.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Confirm rejection"),
    );
    expect(confirmBtnAfter?.disabled).toBe(false);
  });

  it("confirming video rejection calls performReviewAction with actionKey reject", async () => {
    useQueryMock.mockImplementation((key: string) => {
      if (key === "missions.get") return VIDEO_MISSION_TO_VALIDATE;
      return undefined;
    });
    loadReviewContentMock.mockReturnValue(new Promise(() => {}));
    performReviewActionMock.mockResolvedValue({ ok: true });

    await render();

    const rejectBtn = Array.from(document.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Reject with feedback"),
    );
    await act(async () => {
      rejectBtn?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const textarea = document.querySelector('[data-testid="reject-feedback"]') as HTMLTextAreaElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        "value",
      )!.set!;
      setter.call(textarea, "The pacing is too fast");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });

    const confirmBtn = Array.from(document.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Confirm rejection"),
    );
    await act(async () => {
      confirmBtn?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {});

    expect(performReviewActionMock).toHaveBeenCalledWith({
      missionId: "mission-1",
      actionKey: "reject",
      input: { feedback: "The pacing is too fast" },
    });
    expect(routerPushMock).toHaveBeenCalledWith("/projects/instance-1/missions");
  });

  it("shows error message when video rejection via performReviewAction fails", async () => {
    useQueryMock.mockImplementation((key: string) => {
      if (key === "missions.get") return VIDEO_MISSION_TO_VALIDATE;
      return undefined;
    });
    loadReviewContentMock.mockReturnValue(new Promise(() => {}));
    performReviewActionMock.mockImplementation((args: Record<string, unknown>) => {
      if (args.actionKey === "reject") return Promise.reject(new Error("video rejection failed"));
      return Promise.resolve({ ok: true });
    });

    await render();

    const rejectBtn = Array.from(document.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Reject with feedback"),
    );
    await act(async () => {
      rejectBtn?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const textarea = document.querySelector('[data-testid="reject-feedback"]') as HTMLTextAreaElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        "value",
      )!.set!;
      setter.call(textarea, "Needs work");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });

    const confirmBtn = Array.from(document.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Confirm rejection"),
    );
    await act(async () => {
      confirmBtn?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {});

    expect(document.body.textContent).toContain("video rejection failed");
    expect(routerPushMock).not.toHaveBeenCalled();
  });
});

describe("Review module architecture guard (#357)", () => {
  it("does not branch rendering, actions, or transitions on templateId", () => {
    const source = readFileSync(
      join(__dirname, "../src/components/mission-review-page.tsx"),
      "utf8",
    );
    // The only allowed reference is passing `templateId` straight through as
    // an opaque query argument (resolving the Template's manifest) — never
    // reading it to decide what to render or which action/transition is
    // available. Any comparison/branch on templateId reintroduces exactly
    // the coupling #357 removed.
    const templateIdBranchPattern =
      /templateId\s*(===|!==|==|!=)|\btemplateId\s*:\s*"[^"]|switch\s*\(\s*[\w.?]*templateId\s*\)|case\s+["'][^"']*["']\s*:.*templateId/;
    const offendingLines = source
      .split("\n")
      .map((line, index) => ({ line, number: index + 1 }))
      .filter(({ line }) => templateIdBranchPattern.test(line));

    expect(offendingLines, JSON.stringify(offendingLines)).toEqual([]);
  });
});
