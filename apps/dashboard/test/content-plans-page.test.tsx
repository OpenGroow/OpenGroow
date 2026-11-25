/** @vitest-environment jsdom */

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ContentPlansContent } from "../src/components/content-plans-page";

// jsdom has no PointerEvent, which the Checkbox primitive dispatches on click.
globalThis.PointerEvent ??= MouseEvent as typeof PointerEvent;

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const useQueryMock = vi.fn();
const mutations = { update: vi.fn(), remove: vi.fn() };

const approveMock = vi.fn();
const rejectMock = vi.fn();

vi.mock("convex/react", () => ({
  useQuery: (...args: unknown[]) => useQueryMock(...args),
  useMutation: (key: string) => {
    if (key === "content_plan_decision.approve") return approveMock;
    if (key === "content_plan_decision.reject") return rejectMock;
    return key === "content_plan_edit.update" ? mutations.update : mutations.remove;
  },
}));
vi.mock("@convex/_generated/api", () => ({
  api: {
    content_plan_review: { current: "content_plan_review.current", history: "content_plan_review.history" },
    content_plan_edit: { update: "content_plan_edit.update", remove: "content_plan_edit.remove", recipeOptions: "content_plan_edit.recipeOptions" },
    content_plan_decision: { approve: "content_plan_decision.approve", reject: "content_plan_decision.reject" },
  },
}));

function makeContent(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    _id: "pc-1", kind: "video", missionType: "make_video", title: "Reaction to article 1", brief: "Film a silent close-up reaction.",
    plannedAt: "2030-03-06", intent: "exploit", rationale: "Reactions led last month.", status: "proposed",
    publishTargets: [{ target: "social:example", uncertain: false }],
    recipe: { id: "rec-1", name: "Reel recipe" }, creativeFamily: { id: "fam-1", name: "Reaction" }, source: { id: "src-1", label: "Article 1" },
    ...overrides,
  };
}

function makeDraft(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    _id: "plan-1", periodStart: "2030-03-05", periodEnd: "2030-03-11", rationale: "## Strategy\n\nDouble down on reactions.", status: "draft", createdAt: Date.UTC(2030, 2, 4),
    contents: [makeContent(), makeContent({ _id: "pc-2", title: "Carousel test", kind: "carousel", intent: "explore", source: null })],
    quantities: [{ kind: "video", count: 1 }, { kind: "carousel", count: 1 }],
    distribution: { explore: 1, exploit: 1 },
    ...overrides,
  };
}

describe("ContentPlansContent", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.UTC(2030, 2, 8, 12));
    useQueryMock.mockReset();
    mutations.update.mockReset().mockResolvedValue(undefined);
    mutations.remove.mockReset().mockResolvedValue(undefined);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
    vi.useRealTimers();
  });

  async function render({ draft, history = [] }: { draft?: unknown; history?: unknown[] }) {
    useQueryMock.mockImplementation((key: string) => (key === "content_plan_review.current" ? draft : key === "content_plan_review.history" ? history : key === "content_plan_edit.recipeOptions" ? [{ id: "rec-1", name: "Reel recipe" }, { id: "rec-2", name: "Other recipe" }] : undefined));
    await act(async () => {
      root.render(<ContentPlansContent instanceId="instance-1" />);
    });
  }
  const text = () => document.body.textContent ?? "";
  async function click(el: Element) {
    await act(async () => {
      el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
  }

  it("shows an empty state pointing to the Jobs page when there is no draft", async () => {
    await render({ draft: null });
    expect(text()).toContain("No draft Content Plan");
    expect(Array.from(document.querySelectorAll("a")).find((a) => a.textContent?.includes("Jobs"))?.getAttribute("href")).toBe("/projects/instance-1/jobs");
  });

  it("shows the draft period, rationale, quantities by format and exploration distribution", async () => {
    await render({ draft: makeDraft() });
    expect(text()).toContain("Mar 5, 2030 to Mar 11, 2030");
    expect(document.querySelector("section[aria-label='Rationale'] h2")?.textContent).toBe("Strategy");
    expect(Array.from(document.querySelectorAll("ul[aria-label='Quantities by format'] li")).map((li) => li.textContent)).toEqual(["1 video", "1 carousel"]);
    expect(document.querySelector("[aria-label='Exploration and exploitation']")?.textContent).toBe("1 exploring · 1 exploiting");
  });

  it("lists every proposal with its title, Recipe, Creative Family, date, targets, intent, brief, rationale and Source", async () => {
    await render({ draft: makeDraft() });
    const first = document.querySelector("li[data-content='pc-1']")!;
    for (const expected of ["Reaction to article 1", "Mar 6, 2030", "Exploit", "Why this content?", "Reactions led last month.", "Reel recipe", "Reaction", "Article 1", "social:example"]) {
      expect(first.textContent).toContain(expected);
    }
    expect(first.textContent).not.toContain("Film a silent close-up reaction.");
    expect(document.querySelector("li[data-content='pc-2']")?.textContent).toContain("Explore");
    expect(document.querySelector("li[data-content='pc-2']")?.textContent).not.toContain("Source");
  });

  it("keeps the production brief collapsed until asked, and collapses it again", async () => {
    await render({ draft: makeDraft() });
    const first = document.querySelector("li[data-content='pc-1']")!;
    const toggle = () => [...first.querySelectorAll("button")].find((b) => /Full production brief|Hide production brief/.test(b.textContent ?? ""))!;
    expect(toggle().getAttribute("aria-expanded")).toBe("false");
    await click(toggle());
    expect(first.textContent).toContain("Film a silent close-up reaction.");
    expect(toggle().getAttribute("aria-expanded")).toBe("true");
    await click(toggle());
    expect(first.textContent).not.toContain("Film a silent close-up reaction.");
  });

  it("shows a long plan rationale as a preview with a Show full rationale button", async () => {
    const tail = "FINAL-SENTENCE-MARKER";
    await render({ draft: makeDraft({ rationale: `## Strategy\n\n${"Reactions keep performing well. ".repeat(60)}\n\n${tail}` }) });
    const section = () => document.querySelector("section[aria-label='Rationale']")!;
    expect(section().textContent).not.toContain(tail);
    expect(section().querySelector("h2")?.textContent).toBe("Strategy");
    const toggle = () => section().querySelector("button")!;
    expect(toggle().textContent).toBe("Show full rationale");
    await click(toggle());
    expect(section().textContent).toContain(tail);
    expect(section().querySelector("button")).toBeNull();
  });

  it("offers no rationale toggle when the rationale is short", async () => {
    await render({ draft: makeDraft() });
    expect(document.querySelector("section[aria-label='Rationale'] button")).toBeNull();
  });

  it("flags a publish target whose compatibility is uncertain, and only that one", async () => {
    const contents = [makeContent({ publishTargets: [{ target: "social:example", uncertain: true, reason: "Not confirmed for video" }, { target: "blog:example", uncertain: false }] })];
    await render({ draft: makeDraft({ contents }) });
    expect(document.querySelector("li[data-target='social:example']")?.textContent).toContain("Compatibility uncertain");
    expect(document.querySelector("li[data-target='social:example']")?.textContent).toContain("Not confirmed for video");
    expect(document.querySelector("li[data-target='blog:example']")?.textContent).not.toContain("uncertain");
  });

  it("warns when the period has passed, and keeps the draft", async () => {
    await render({ draft: makeDraft({ periodEnd: "2030-03-07" }) });
    expect(document.querySelector("[role='alert']")?.textContent).toContain("period has passed");
    expect(text()).toContain("Reaction to article 1");
  });

  it("does not warn on the last day of the period", async () => {
    await render({ draft: makeDraft({ periodEnd: "2030-03-08" }) });
    expect(document.querySelector("[role='alert']")).toBeNull();
  });

  it("lists previous plans with their statuses, and says so when there are none", async () => {
    await render({
      draft: null,
      history: [
        { _id: "p-2", periodStart: "2030-02-26", periodEnd: "2030-03-04", rationale: "r", status: "rejected", createdAt: Date.UTC(2030, 1, 25), counts: { total: 3, approved: 0, rejected: 3 } },
        { _id: "p-1", periodStart: "2030-02-19", periodEnd: "2030-02-25", rationale: "r", status: "approved", createdAt: Date.UTC(2030, 1, 18), counts: { total: 4, approved: 3, rejected: 1 } },
      ],
    });
    const entries = Array.from(document.querySelectorAll("li[data-plan]"));
    expect(entries.map((e) => e.getAttribute("data-plan"))).toEqual(["p-2", "p-1"]);
    expect(entries[0]!.textContent).toContain("Rejected");
    expect(entries[1]!.textContent).toContain("Approved");
    expect(entries[1]!.textContent).toContain("3 approved");
    await render({ draft: null, history: [] });
    expect(text()).toContain("No approved or rejected plan yet.");
  });
  describe("editing a draft", () => {
    const card = (id = "pc-1") => document.querySelector(`li[data-content='${id}']`)!;
    const button = (root: Element, name: string) => Array.from(root.querySelectorAll("button")).find((b) => b.textContent?.trim() === name) as HTMLButtonElement;
    async function type(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
      const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      await act(async () => {
        Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value);
        el.dispatchEvent(new Event("input", { bubbles: true }));
      });
    }
    const field = <T extends Element>(name: string) => card().querySelector<T>(`[aria-label='${name}']`)!;
    const withTargets = () => makeDraft({ contents: [makeContent({ publishTargets: [{ target: "social:example", uncertain: false }, { target: "blog:example", uncertain: false }] })] });

    it("opens a form prefilled with the current values and sends only what changed", async () => {
      await render({ draft: withTargets() });
      await click(button(card(), "Edit"));
      expect(field<HTMLInputElement>("Title").value).toBe("Reaction to article 1");
      expect(field<HTMLTextAreaElement>("Brief").value).toBe("Film a silent close-up reaction.");
      expect(field<HTMLInputElement>("Date")).toMatchObject({ value: "2030-03-06", min: "2030-03-08", max: "2030-03-11" });
      await type(field<HTMLInputElement>("Title"), "New title");
      await type(field<HTMLInputElement>("Date"), "2030-03-09");
      await click(button(card(), "Save"));
      expect(mutations.update).toHaveBeenCalledWith({ contentId: "pc-1", title: "New title", plannedAt: "2030-03-09" });
      expect(card().querySelector("[aria-label='Title']")).toBeNull();
    });

    it("changes the Recipe to another of the same Mission type", async () => {
      await render({ draft: withTargets() });
      await click(button(card(), "Edit"));
      const select = card().querySelector("select") as HTMLSelectElement;
      expect(Array.from(select.options).map((o) => o.textContent)).toEqual(["Reel recipe", "Other recipe"]);
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(select, "rec-2");
        select.dispatchEvent(new Event("change", { bubbles: true }));
      });
      await click(button(card(), "Save"));
      expect(mutations.update).toHaveBeenCalledWith({ contentId: "pc-1", recipeId: "rec-2" });
    });

    it("lets Publish targets be unchecked but offers no way to add one", async () => {
      await render({ draft: withTargets() });
      await click(button(card(), "Edit"));
      const boxes = Array.from(card().querySelectorAll("[role='checkbox']")) as HTMLElement[];
      expect(boxes).toHaveLength(2);
      await click(boxes[0]!);
      await click(button(card(), "Save"));
      expect(mutations.update).toHaveBeenCalledWith({ contentId: "pc-1", publishTargets: ["blog:example"] });
    });

    it("shows the refusal of the server and keeps the form open", async () => {
      mutations.update.mockRejectedValueOnce(new Error("The date is in the past."));
      await render({ draft: withTargets() });
      await click(button(card(), "Edit"));
      await type(field<HTMLInputElement>("Title"), "x");
      await click(button(card(), "Save"));
      expect(card().querySelector("[role='alert']")?.textContent).toContain("The date is in the past.");
      expect(card().querySelector("[aria-label='Title']")).not.toBeNull();
    });

    it("removes a proposal, and shows a removed one without edit controls", async () => {
      await render({ draft: withTargets() });
      await click(button(card(), "Remove"));
      expect(mutations.remove).toHaveBeenCalledWith({ contentId: "pc-1" });
      await render({ draft: makeDraft({ contents: [makeContent({ status: "rejected" })] }) });
      expect(card().textContent).toContain("Removed");
      expect(button(card(), "Edit")).toBeUndefined();
      expect(button(card(), "Remove")).toBeUndefined();
    });
  });


  describe("plan decision", () => {
    const button = (label: string) => Array.from(document.querySelectorAll("button")).find((b) => b.textContent === label) as HTMLButtonElement;
    const click = async (label: string) => {
      await act(async () => {
        button(label).click();
      });
    };

    beforeEach(() => {
      approveMock.mockReset();
      rejectMock.mockReset();
    });

    it("approves the plan by its id", async () => {
      approveMock.mockResolvedValue({ ok: true });
      await render({ draft: makeDraft() });
      await click("Approve plan");
      expect(approveMock).toHaveBeenCalledWith({ planId: "plan-1" });
      expect(document.querySelector("[role='alert']")).toBeNull();
    });

    it("shows the reason an approval is refused", async () => {
      approveMock.mockResolvedValue({ ok: false, reason: "past_date", message: "1 retained content is dated in the past (2030-03-03)." });
      await render({ draft: makeDraft() });
      await click("Approve plan");
      expect(document.querySelector("[role='alert']")?.textContent).toContain("dated in the past");
    });

    it("rejects the plan by its id", async () => {
      rejectMock.mockResolvedValue({ ok: true });
      await render({ draft: makeDraft() });
      await click("Reject plan");
      expect(rejectMock).toHaveBeenCalledWith({ planId: "plan-1" });
    });
  });
});
