/** @vitest-environment jsdom */

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Id } from "@convex/_generated/dataModel";
import { MissionKanbanBoard } from "../src/components/mission-kanban-board";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { children?: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
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

  it("shows no From Source badge on a card (the Mission page shows the Source)", async () => {
    await render([makeMission({ sourceObservationId: "observation-1" as Id<"sources"> })]);

    expect(document.body.textContent).not.toContain("From Source");
    expect(document.querySelector("[data-testid='from-observation-badge']")).toBeNull();
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

  it.each([
    ["to_validate", "markdown", "article-mcp"],
    ["to_validate", "video", "video-mcp"],
    ["approved", "markdown", "article-mcp"],
    ["approved", "video", "video-mcp"],
  ] as const)("has no Review or Publish button on a %s %s mission: the card opens the one mission page", async (status, kind, service) => {
    const mission = makeMission({
      _id: `m-${status}-${kind}`,
      status,
      lastResult: {
        status: "needs_human_review",
        summary: "Ready",
        reviewQuestions: [],
        artifact: { kind, external: { service, id: "art-1" }, metadata: {} },
      },
    });
    await render([mission], "proj-abc");
    const links = Array.from(document.querySelectorAll("a"));
    expect(links.some((a) => a.href.includes("/review"))).toBe(false);
    expect(links.some((a) => a.textContent === "Review" || a.textContent === "Publish")).toBe(false);
    expect(links.find((a) => a.href.endsWith(`/projects/proj-abc/missions/m-${status}-${kind}`))).toBeTruthy();
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

  // ── Delete lives on the mission page ────────────────────────────────────────

  it.each(["todo", "to_validate", "approved", "done", "failed", "doing"] as const)(
    "has no delete control on a %s card (deleting is in the More actions menu of the mission page)",
    async (status) => {
      await render([makeMission({ _id: `m-no-del-${status}`, status })]);
      expect(document.body.querySelector("[data-delete-mission]")).toBeNull();
      expect(document.body.querySelector('[aria-label="Delete mission"]')).toBeNull();
    },
  );
});
