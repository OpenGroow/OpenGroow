/** @vitest-environment jsdom */

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Id } from "@convex/_generated/dataModel";
import { MissionKanbanBoard } from "../src/components/mission-kanban-board";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const deleteMissionMock = vi.fn();

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { children?: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("convex/react", () => ({
  useMutation: () => deleteMissionMock,
}));

vi.mock("@convex/_generated/api", () => ({
  api: {
    missions: { deleteMission: "missions.deleteMission" },
  },
}));

type Mission = {
  _id: string;
  type: string;
  status: "todo" | "doing" | "blocked" | "to_validate" | "approved" | "done" | "failed" | "cancelled";
  updatedAt: number;
  number?: number;
  name?: string;
  summary?: string;
  sourceObservationId?: Id<"sources">;
  lastResult?:
    | {
        status: "needs_human_review";
        summary: string;
        reviewQuestions: string[];
        artifact?: {
          kind?: "markdown" | "metadata" | "image" | "video";
          external?: { service: string; id: string };
          metadata?: Record<string, string | number | boolean>;
        };
      }
    | {
      status: "blocked_external";
        summary: string;
        message: string;
        blockerCode: string;
        resolution?: { kind: "link"; url: string } | { kind: "execution_device" };
      };
};

function makeMission(overrides: Partial<Mission> = {}): Mission {
  return {
    _id: `mission-${Math.random()}`,
    type: "create_article",
    status: "todo",
    updatedAt: Date.now(),
    ...overrides,
  };
}

describe("MissionKanbanBoard", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    deleteMissionMock.mockReset();
    deleteMissionMock.mockResolvedValue(undefined);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
    document.body.innerHTML = "";
  });

  async function render(missions: Mission[], projectId = "proj-1") {
    await act(async () => {
      root.render(<MissionKanbanBoard missions={missions} projectId={projectId} />);
    });
  }

  it("renders all 6 column headers", async () => {
    await render([]);
    const text = document.body.textContent ?? "";
    expect(text).toContain("To do");
    expect(text).toContain("In progress");
    expect(text).toContain("Blocked");
    expect(text).toContain("To validate");
    expect(text).toContain("To publish");
    expect(text).toContain("Done");
  });

  it("places a todo mission in the 'To do' column", async () => {
    const mission = makeMission({ _id: "m-todo", type: "seo_article", status: "todo" });
    await render([mission]);
    const text = document.body.textContent ?? "";
    expect(text).toContain("Seo Article");
  });

  it("shows a From Source badge for automatically-created production missions", async () => {
    await render([makeMission({ sourceObservationId: "observation-1" as Id<"sources"> })]);

    expect(document.body.textContent).toContain("From Source");
    expect(document.querySelector("[data-testid='from-observation-badge']")).toBeTruthy();
  });

  it("places a doing mission in the 'In progress' column", async () => {
    const mission = makeMission({ _id: "m-doing", type: "seo_article", status: "doing" });
    await render([mission]);
    const columns = document.body.querySelectorAll("[data-column]");
    const inProgressCol = Array.from(columns).find(
      (col) => col.getAttribute("data-column") === "doing"
    );
    expect(inProgressCol?.textContent).toContain("Seo Article");
  });

  it("places a to_validate mission in the 'To validate' column", async () => {
    const mission = makeMission({ status: "to_validate" });
    await render([mission]);
    const col = document.body.querySelector("[data-column='to_validate']");
    expect(col?.textContent).toContain("Create Article");
  });

  it("places an approved mission in the 'To publish' column", async () => {
    const mission = makeMission({ status: "approved" });
    await render([mission]);
    const col = document.body.querySelector("[data-column='approved']");
    expect(col?.textContent).toContain("Create Article");
  });

  it("places a done mission in the 'Done' column", async () => {
    const mission = makeMission({ status: "done" });
    await render([mission]);
    const col = document.body.querySelector("[data-column='done']");
    expect(col?.textContent).toContain("Create Article");
  });

  it("places a failed mission in the 'In progress' column with a 'Failed' badge", async () => {
    const mission = makeMission({ status: "failed" });
    await render([mission]);
    const col = document.body.querySelector("[data-column='doing']");
    expect(col?.textContent).toContain("Create Article");
    expect(col?.textContent).toContain("Failed");
  });

  it("places a cancelled mission in the 'In progress' column, same as failed", async () => {
    const mission = makeMission({ status: "cancelled" });
    await render([mission]);
    const col = document.body.querySelector("[data-column='doing']");
    expect(col?.textContent).toContain("Create Article");
  });

  it("badges a cancelled mission 'Stopped' so it is not mistaken for a live one", async () => {
    const mission = makeMission({ status: "cancelled" });
    await render([mission]);
    const col = document.body.querySelector("[data-column='doing']");
    expect(col?.textContent).toContain("Stopped");
  });

  it("places a blocked mission in its own 'Blocked' column, not 'doing'", async () => {
    const mission = makeMission({
      status: "blocked",
      lastResult: {
        status: "blocked_external",
        summary: "Waiting on human review",
        message: "Your keyword batch needs human validation.",
        blockerCode: "keyword_batch_pending",
        resolution: { kind: "link", url: "https://article-mcp.example.com/review" },
      },
    });
    await render([mission]);
    const blockedCol = document.body.querySelector("[data-column='blocked']");
    expect(blockedCol?.textContent).toContain("Create Article");
    const doingCol = document.body.querySelector("[data-column='doing']");
    expect(doingCol?.textContent).not.toContain("Create Article");
  });

  it("shows a 'Blocked' badge (not 'Failed', not red) on a blocked mission card", async () => {
    const mission = makeMission({
      _id: "m-blocked-badge",
      status: "blocked",
      lastResult: {
        status: "blocked_external",
        summary: "Waiting on human review",
        message: "Your keyword batch needs human validation.",
        blockerCode: "keyword_batch_pending",
        resolution: { kind: "link", url: "https://article-mcp.example.com/review" },
      },
    });
    await render([mission]);
    const card = document.body.querySelector("[data-mission='m-blocked-badge']");
    expect(card?.textContent).toContain("Blocked");
    expect(card?.textContent).not.toContain("Failed");
    const badge = card?.querySelector(".text-red-700");
    expect(badge).toBeFalsy();
  });

  it("shows the message and a clickable resolution link on a blocked mission card", async () => {
    const mission = makeMission({
      _id: "m-blocked-link",
      status: "blocked",
      lastResult: {
        status: "blocked_external",
        summary: "Waiting on human review",
        message: "Your keyword batch needs human validation.",
        blockerCode: "keyword_batch_pending",
        resolution: { kind: "link", url: "https://article-mcp.example.com/review" },
      },
    });
    await render([mission]);
    const card = document.body.querySelector("[data-mission='m-blocked-link']");
    expect(card?.textContent).toContain("Your keyword batch needs human validation.");
    const link = Array.from(card?.querySelectorAll("a") ?? []).find(
      (a) => a.href === "https://article-mcp.example.com/review",
    );
    expect(link).toBeTruthy();
  });

  it("shows the 'Failed' badge only on failed missions", async () => {
    const missions = [
      makeMission({ status: "todo" }),
      makeMission({ status: "done" }),
    ];
    await render(missions);
    expect(document.body.textContent).not.toContain("Failed");
  });

  it("renders empty-state text for columns with no missions", async () => {
    await render([]);
    const cols = document.body.querySelectorAll("[data-column]");
    expect(cols.length).toBe(6);
  });

  it("shows a Review button for to_validate SEO missions with artifact.external.id (strict contract)", async () => {
    const mission = makeMission({
      _id: "m-validate",
      status: "to_validate",
      lastResult: {
        status: "needs_human_review",
        summary: "Article ready",
        reviewQuestions: [],
        artifact: { kind: "markdown", external: { service: "article-mcp", id: "art-1" }, metadata: { keyword: "octopus" } },
      },
    });
    await render([mission], "proj-abc");
    const links = Array.from(document.querySelectorAll("a"));
    const reviewLink = links.find((a) => a.href.includes("/missions/m-validate/review"));
    expect(reviewLink).toBeTruthy();
    expect(reviewLink?.href).toContain("/projects/proj-abc/");
  });

  it("shows a Review button for to_validate video missions with artifact.external.id (strict contract)", async () => {
    const mission = makeMission({
      _id: "m-video-validate",
      type: "create_video",
      status: "to_validate",
      lastResult: {
        status: "needs_human_review",
        summary: "Video ready",
        reviewQuestions: [],
        artifact: { kind: "video", external: { service: "video-mcp", id: "video-run-1" }, metadata: { runId: "video-run-1" } },
      },
    });
    await render([mission], "proj-abc");
    const links = Array.from(document.querySelectorAll("a"));
    const reviewLink = links.find((a) => a.href.includes("/missions/m-video-validate/review"));
    expect(reviewLink).toBeTruthy();
    expect(reviewLink?.textContent).toContain("Review");
  });

  it("shows a Publish button for approved missions with artifact.external.id (strict contract)", async () => {
    const mission = makeMission({
      _id: "m-approved",
      status: "approved",
      lastResult: {
        status: "needs_human_review",
        summary: "Article ready",
        reviewQuestions: [],
        artifact: { kind: "markdown", external: { service: "article-mcp", id: "art-1" }, metadata: {} },
      },
    });
    await render([mission], "proj-abc");
    const links = Array.from(document.querySelectorAll("a"));
    const publishLink = links.find((a) => a.href.includes("/missions/m-approved/review"));
    expect(publishLink).toBeTruthy();
    expect(publishLink?.textContent).toContain("Publish");
  });

  it("shows a Publish button for approved video missions with artifact.external.id (strict contract)", async () => {
    const mission = makeMission({
      _id: "m-video-approved",
      type: "create_video",
      status: "approved",
      lastResult: {
        status: "needs_human_review",
        summary: "Video ready",
        reviewQuestions: [],
        artifact: { kind: "video", external: { service: "video-mcp", id: "video-run-2" }, metadata: { runId: "video-run-2" } },
      },
    });
    await render([mission], "proj-abc");
    const links = Array.from(document.querySelectorAll("a"));
    const publishLink = links.find((a) => a.href.includes("/missions/m-video-approved/review"));
    expect(publishLink).toBeTruthy();
    expect(publishLink?.textContent).toContain("Publish");
  });

  it("does NOT show Review button for missions with legacy metadata.articleId and no external.id (unmigrated)", async () => {
    const mission = makeMission({
      _id: "m-legacy-no-review",
      status: "to_validate",
      lastResult: {
        status: "needs_human_review",
        summary: "Article ready",
        reviewQuestions: [],
        artifact: { metadata: { articleId: "art-1" } },
      },
    });
    await render([mission], "proj-abc");
    const links = Array.from(document.querySelectorAll("a"));
    const reviewLink = links.find((a) => a.href.includes("/missions/m-legacy-no-review/review"));
    expect(reviewLink).toBeFalsy();
  });

  it("does not show action buttons for missions without an artifact external.id", async () => {
    const mission = makeMission({ status: "to_validate" });
    await render([mission]);
    const links = Array.from(document.querySelectorAll("a"));
    const actionLink = links.find((a) => a.href.includes("/review"));
    expect(actionLink).toBeFalsy();
  });

  it("distributes multiple missions into correct columns", async () => {
    const missions = [
      makeMission({ _id: "a", status: "todo" }),
      makeMission({ _id: "b", status: "doing" }),
      makeMission({ _id: "c", status: "done" }),
    ];
    await render(missions);
    expect(document.body.querySelector("[data-column='todo']")?.querySelectorAll("[data-mission]").length).toBe(1);
    expect(document.body.querySelector("[data-column='doing']")?.querySelectorAll("[data-mission]").length).toBe(1);
    expect(document.body.querySelector("[data-column='done']")?.querySelectorAll("[data-mission]").length).toBe(1);
  });

  it("shows the Title Case type in the card title and the number below, dropping the redundant default summary line", async () => {
    const mission = makeMission({
      type: "seo_article",
      number: 7,
      status: "todo",
      name: "seo_article #7",
    });
    await render([mission]);
    const title = container.querySelector("[data-mission] span");
    expect(title?.textContent).toBe("Seo Article");
    const summary = container.querySelector("[data-mission] p");
    expect(summary).toBeNull();
    const number = container.querySelector("[data-mission-number]");
    expect(number?.textContent).toBe("#7");
  });

  it("shows the Title Case type in the card title even when the mission has no number", async () => {
    const mission = makeMission({ type: "seo_article", status: "todo" });
    await render([mission]);
    const title = container.querySelector("[data-mission] span");
    expect(title?.textContent).toBe("Seo Article");
  });

  it("keeps a custom summary distinct from the type visible below the title", async () => {
    const mission = makeMission({
      type: "seo_article",
      number: 7,
      status: "todo",
      summary: "Draft ready for review",
    });
    await render([mission]);
    const summary = container.querySelector("[data-mission] p");
    expect(summary?.textContent).toBe("Draft ready for review");
    const number = container.querySelector("[data-mission-number]");
    expect(number?.textContent).toBe("#7");
  });

  it("shows the name on the card when there is no summary", async () => {
    const mission = makeMission({ name: "My SEO Article", status: "todo" });
    await render([mission]);
    expect(document.body.textContent).toContain("My SEO Article");
  });

  it("shows the summary on the card when it exists, not the name", async () => {
    const mission = makeMission({
      name: "My SEO Article",
      summary: "Article about running shoes for Q1",
      status: "doing",
    });
    await render([mission]);
    expect(document.body.textContent).toContain("Article about running shoes for Q1");
    expect(document.body.textContent).not.toContain("My SEO Article");
  });

  it("card links to mission detail page", async () => {
    const mission = makeMission({ _id: "m-detail", status: "todo" });
    await render([mission], "proj-xyz");
    const links = Array.from(document.querySelectorAll("a"));
    const detailLink = links.find((a) => a.href.includes("/projects/proj-xyz/missions/m-detail") && !a.href.includes("/review"));
    expect(detailLink).toBeTruthy();
  });

  it("Review link still points to /review and not the detail page", async () => {
    const mission = makeMission({
      _id: "m-review",
      status: "to_validate",
      lastResult: {
        status: "needs_human_review",
        summary: "Ready",
        reviewQuestions: [],
        artifact: { kind: "markdown", external: { service: "article-mcp", id: "art-1" }, metadata: {} },
      },
    });
    await render([mission], "proj-abc");
    const links = Array.from(document.querySelectorAll("a"));
    const reviewLink = links.find((a) => a.href.includes("/review"));
    expect(reviewLink).toBeTruthy();
    expect(reviewLink?.href).toContain("/missions/m-review/review");
  });

  // ── Delete control ──────────────────────────────────────────────────────────

  it("shows a delete button on non-doing missions", async () => {
    const statuses: Mission["status"][] = ["todo", "to_validate", "approved", "done", "failed"];
    for (const status of statuses) {
      const mission = makeMission({ _id: `m-del-${status}`, status });
      await render([mission]);
      const btn = document.body.querySelector(`[data-delete-mission="m-del-${status}"]`);
      expect(btn, `expected delete button for status=${status}`).toBeTruthy();
      // Reset DOM between iterations
      await act(async () => { root.render(<MissionKanbanBoard missions={[]} projectId="p" />); });
    }
  });

  it("does not show a delete button on doing missions", async () => {
    const mission = makeMission({ _id: "m-doing-del", status: "doing" });
    await render([mission]);
    const btn = document.body.querySelector("[data-delete-mission]");
    expect(btn).toBeFalsy();
  });

  it("calls deleteMission mutation after confirm=true", async () => {
    vi.spyOn(window, "confirm").mockReturnValueOnce(true);
    const mission = makeMission({ _id: "m-del-confirm", status: "todo" });
    await render([mission]);

    const btn = document.body.querySelector(`[data-delete-mission="m-del-confirm"]`) as HTMLButtonElement;
    expect(btn).toBeTruthy();

    await act(async () => {
      btn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      // Allow the async handler to settle
      await Promise.resolve();
    });

    expect(deleteMissionMock).toHaveBeenCalledWith({ missionId: "m-del-confirm" });
  });

  it("does not call deleteMission mutation when confirm=false", async () => {
    vi.spyOn(window, "confirm").mockReturnValueOnce(false);
    const mission = makeMission({ _id: "m-del-cancel", status: "todo" });
    await render([mission]);

    const btn = document.body.querySelector(`[data-delete-mission="m-del-cancel"]`) as HTMLButtonElement;
    await act(async () => {
      btn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(deleteMissionMock).not.toHaveBeenCalled();
  });

  it("clicking delete does not navigate to the detail page (stopPropagation)", async () => {
    vi.spyOn(window, "confirm").mockReturnValueOnce(false);
    const mission = makeMission({ _id: "m-del-nav", status: "todo" });
    await render([mission], "proj-nav");

    const btn = document.body.querySelector(`[data-delete-mission="m-del-nav"]`) as HTMLButtonElement;

    // Dispatch the click and capture whether the event was cancelled.
    // handleDelete calls e.preventDefault() + e.stopPropagation(). If those
    // calls are removed, defaultPrevented stays false and this assertion fails.
    const clickEvent = new MouseEvent("click", { bubbles: true, cancelable: true });
    await act(async () => {
      btn.dispatchEvent(clickEvent);
      await Promise.resolve();
    });

    expect(clickEvent.defaultPrevented).toBe(true);

    // Belt-and-suspenders: the detail <a> must not receive a click.
    const card = document.body.querySelector(`[data-mission="m-del-nav"]`) as HTMLElement;
    const detailLink = card.querySelector("a") as HTMLAnchorElement;
    let linkClicked = false;
    detailLink?.addEventListener("click", () => { linkClicked = true; });

    // Fire a second click (confirm=false again so no mutation call).
    vi.spyOn(window, "confirm").mockReturnValueOnce(false);
    const clickEvent2 = new MouseEvent("click", { bubbles: true, cancelable: true });
    await act(async () => {
      btn.dispatchEvent(clickEvent2);
      await Promise.resolve();
    });

    expect(linkClicked).toBe(false);
  });
});
