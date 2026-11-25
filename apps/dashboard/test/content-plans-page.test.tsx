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
    content_plan_review: { current: "content_plan_review.current", history: "content_plan_review.history", planDetail: "content_plan_review.planDetail" },
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

  async function render({ draft, history = [], detail }: { draft?: unknown; history?: unknown[]; detail?: unknown }) {
    useQueryMock.mockImplementation((key: string, args: unknown) => (key === "content_plan_review.planDetail" ? (args === "skip" ? undefined : detail) : key === "content_plan_review.current" ? draft : key === "content_plan_review.history" ? history : key === "content_plan_edit.recipeOptions" ? [{ id: "rec-1", name: "Reel recipe" }, { id: "rec-2", name: "Other recipe" }] : undefined));
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

  it("shows the draft period, status, content count and exploration distribution in the card header", async () => {
    await render({ draft: makeDraft() });
    const header = document.querySelector("[aria-label='Plan summary']")!;
    expect(header.textContent).toContain("Planning period");
    expect(header.textContent).toContain("Mar 5, 2030 to Mar 11, 2030");
    expect(header.textContent).toContain("Draft");
    expect(header.querySelector("[aria-label='Content count']")?.textContent).toBe("2 contents");
    expect(header.querySelector("[aria-label='Exploring']")?.textContent).toBe("1 exploring");
    expect(header.querySelector("[aria-label='Exploiting']")?.textContent).toBe("1 exploiting");
    expect(header.textContent).toContain("Approve plan");
    expect(text()).toContain("Planned contents (2)");
  });

  it("does not count removed proposals in the header, and uses the singular for one content", async () => {
    await render({ draft: makeDraft({ contents: [makeContent(), makeContent({ _id: "pc-2", status: "rejected" })] }) });
    expect(document.querySelector("[aria-label='Content count']")?.textContent).toBe("1 content");
  });

  it("lists every proposal with its title, Recipe, Creative Family, date, targets, intent, brief, rationale and Source", async () => {
    await render({ draft: makeDraft() });
    const first = document.querySelector("li[data-content='pc-1']")!;
    for (const expected of ["Reaction to article 1", "Mar 6, 2030", "Exploit", "Why this content?", "Reactions led last month.", "Reel recipe", "Reaction", "Article 1", "social:example"]) {
      expect(first.textContent).toContain(expected);
    }
    expect(first.querySelector("[aria-label='Full production brief']")).toBeNull();
    expect(document.querySelector("li[data-content='pc-2']")?.textContent).toContain("Explore");
    expect(document.querySelector("li[data-content='pc-2']")?.textContent).not.toContain("Source");
  });

  it("keeps the production brief collapsed with a one-line preview, expands it on click and collapses it again", async () => {
    await render({ draft: makeDraft() });
    const first = document.querySelector("li[data-content='pc-1']")!;
    const toggle = () => [...first.querySelectorAll("button")].find((b) => b.textContent?.includes("Production brief"))!;
    const full = () => first.querySelector("[aria-label='Full production brief']");
    expect(toggle().getAttribute("aria-expanded")).toBe("false");
    expect(toggle().textContent).toContain("Film a silent close-up reaction.");
    expect(full()).toBeNull();
    await click(toggle());
    expect(toggle().getAttribute("aria-expanded")).toBe("true");
    expect(full()?.textContent).toBe("Film a silent close-up reaction.");
    await click(toggle());
    expect(full()).toBeNull();
  });

  it("shows the plan rationale as a clamped preview with a Show more button that expands it for good", async () => {
    await render({ draft: makeDraft() });
    const section = () => document.querySelector("section[aria-label='Rationale']")!;
    expect(section().textContent).toContain("Strategic rationale");
    expect(section().querySelector("[data-clamped='true']")?.textContent).toContain("Double down on reactions.");
    const toggle = () => section().querySelector("button")!;
    expect(toggle().textContent).toContain("Show more");
    expect(toggle().getAttribute("aria-expanded")).toBe("false");
    await click(toggle());
    expect(section().querySelector("[data-clamped='true']")).toBeNull();
    expect(section().querySelector("h2")?.textContent).toBe("Strategy");
    expect(section().querySelector("button")).toBeNull();
  });

  it("flags a publish target whose compatibility is uncertain, and only that one", async () => {
    const contents = [makeContent({ publishTargets: [{ target: "social:example", uncertain: true, reason: "Not confirmed for video" }, { target: "blog:example", uncertain: false }] })];
    await render({ draft: makeDraft({ contents }) });
    expect(document.querySelector("li[data-target='social:example']")?.textContent).toContain("Compatibility uncertain");
    expect(document.querySelector("li[data-target='social:example']")?.textContent).toContain("Not confirmed for video");
    expect(document.querySelector("li[data-target='blog:example']")?.textContent).not.toContain("uncertain");
  });

  it("shows a publish target as its account handle, and falls back to the raw key when unavailable", async () => {
    const contents = [makeContent({ publishTargets: [
      { target: "instagram:account_1", uncertain: false, service: "instagram", adapter: "example", label: "@account_1" },
      { target: "gone:example", uncertain: false, unavailable: true },
    ] })];
    await render({ draft: makeDraft({ contents }) });
    expect(document.querySelector("li[data-target='instagram:account_1']")?.textContent).toContain("@account_1");
    expect(document.querySelector("li[data-target='instagram:account_1']")?.textContent).not.toContain("instagram:");
    expect(document.querySelector("li[data-target='gone:example']")?.textContent).toContain("gone:example");
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
    expect(entries[1]!.textContent).toContain("Planned Feb 18, 2030 · 4 contents");
    await render({ draft: null, history: [] });
    expect(text()).toContain("No approved or rejected plan yet.");
  });
  describe("history rows", () => {
    const row = { _id: "p-1", periodStart: "2030-02-19", periodEnd: "2030-02-25", rationale: "## Past strategy\n\nWhy then.", status: "approved", createdAt: Date.UTC(2030, 1, 18), counts: { total: 2, approved: 1, rejected: 1 } };
    const toggle = () => document.querySelector("li[data-plan='p-1'] button[aria-expanded]") as HTMLButtonElement;
    const detail = [makeContent({ _id: "h-1", title: "Kept one", status: "approved" }), makeContent({ _id: "h-2", title: "Dropped one", status: "rejected" })];

    it("stays closed and does not fetch the plan until the row is opened", async () => {
      await render({ draft: null, history: [row], detail });
      expect(toggle().getAttribute("aria-expanded")).toBe("false");
      expect(text()).not.toContain("Kept one");
      expect(useQueryMock.mock.calls.some(([key, args]) => key === "content_plan_review.planDetail" && args !== "skip")).toBe(false);
    });

    it("opens on click, showing the rationale and the contents read-only, with removed ones marked", async () => {
      await render({ draft: null, history: [row], detail });
      await click(toggle());
      expect(toggle().getAttribute("aria-expanded")).toBe("true");
      expect(useQueryMock).toHaveBeenCalledWith("content_plan_review.planDetail", { planId: "p-1" });
      expect(text()).toContain("Past strategy");
      expect(text()).toContain("Kept one");
      expect(document.querySelector("li[data-content='h-2']")!.textContent).toContain("Removed");
      expect(document.querySelector("li[data-plan='p-1'] li[data-content='h-1']")!.textContent).toContain("Reel recipe");
      expect(Array.from(document.querySelectorAll("li[data-plan='p-1'] button")).map((b) => b.textContent)).not.toEqual(expect.arrayContaining(["Edit"]));
      expect(Array.from(document.querySelectorAll("li[data-plan='p-1'] button")).map((b) => b.textContent)).not.toContain("Remove");
    });

    it("closes again on a second click", async () => {
      await render({ draft: null, history: [row], detail });
      await click(toggle());
      await click(toggle());
      expect(toggle().getAttribute("aria-expanded")).toBe("false");
      expect(text()).not.toContain("Kept one");
    });
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
