/** @vitest-environment jsdom */

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EditorialCalendarContent } from "../src/components/editorial-calendar-page";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const useQueryMock = vi.fn();
vi.mock("convex/react", () => ({ useQuery: (...args: unknown[]) => useQueryMock(...args) }));
vi.mock("@convex/_generated/api", () => ({ api: { editorial_calendar: { range: "editorial_calendar.range" } } }));

const item = (over: Record<string, unknown> = {}) => ({
  _id: "pc-1", planId: "plan-1", kind: "video", title: "Reaction to article 1", brief: "Film a silent close-up reaction.", plannedAt: "2030-03-06",
  intent: "exploit", rationale: "Reactions led last month.", publishTargets: ["social:example"], plan: { periodStart: "2030-03-04", periodEnd: "2030-03-10" }, ...over,
});

describe("EditorialCalendarContent", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.UTC(2030, 2, 8, 12));
    useQueryMock.mockReset();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.useRealTimers();
  });

  async function render(items: unknown[] | undefined, truncated = false) {
    useQueryMock.mockImplementation((_key: string, args: { from: string; to: string }) => (items === undefined ? undefined : { items: items.filter((i) => (i as { plannedAt: string }).plannedAt >= args.from && (i as { plannedAt: string }).plannedAt <= args.to), truncated }));
    await act(async () => root.render(<EditorialCalendarContent instanceId="instance-1" />));
  }
  const text = () => document.body.textContent ?? "";
  const click = async (el: Element | null | undefined) => act(async () => (el as HTMLElement).click());
  const button = (label: string) => Array.from(document.querySelectorAll("button")).find((b) => b.textContent?.trim() === label || b.getAttribute("aria-label") === label);

  it("queries the visible month and shows contents on their day in month view", async () => {
    await render([item(), item({ _id: "pc-2", planId: "plan-2", title: "From another plan", plannedAt: "2030-03-20" })]);
    expect(useQueryMock).toHaveBeenCalledWith("editorial_calendar.range", { instanceId: "instance-1", from: "2030-03-01", to: "2030-03-31" });
    expect(text()).toContain("March 2030");
    expect(document.querySelector("[data-day='2030-03-06']")?.textContent).toContain("Reaction to article 1");
    expect(document.querySelector("[data-day='2030-03-20']")?.textContent).toContain("From another plan");
  });

  it("navigates across months", async () => {
    await render([item({ _id: "pc-3", title: "April content", plannedAt: "2030-04-02" })]);
    expect(text()).not.toContain("April content");
    await click(button("Next month"));
    expect(text()).toContain("April 2030");
    expect(text()).toContain("April content");
    await click(button("Previous month"));
    await click(button("Previous month"));
    expect(text()).toContain("February 2030");
  });

  it("lists the month's contents by date in list view", async () => {
    await render([item({ _id: "pc-2", title: "Later", plannedAt: "2030-03-12" }), item()]);
    await click(button("List"));
    expect(Array.from(document.querySelectorAll("li[data-content]")).map((li) => li.getAttribute("data-content"))).toEqual(["pc-1", "pc-2"]);
  });

  it("shows details with a link to the originating plan", async () => {
    await render([item()]);
    await click(document.querySelector("[data-day='2030-03-06'] button"));
    const details = document.querySelector("[aria-label='Content details']")!;
    for (const expected of ["Reaction to article 1", "Film a silent close-up reaction.", "Reactions led last month.", "social:example", "Exploit", "video"]) expect(details.textContent).toContain(expected);
    expect(details.querySelector("a")?.getAttribute("href")).toBe("/projects/instance-1/content-plans#plan-plan-1");
  });

  it("is read-only and never speaks of scheduled Publication", async () => {
    await render([item()]);
    await click(document.querySelector("[data-day='2030-03-06'] button"));
    expect(document.querySelectorAll("input, textarea, select, [draggable='true']").length).toBe(0);
    const labels = Array.from(document.querySelectorAll("button")).map((b) => b.getAttribute("aria-label") || b.textContent?.trim());
    expect(labels.every((l) => ["List", "Month", "Previous month", "Next month", "Today", undefined, null].includes(l) || /^Reaction/.test(l ?? ""))).toBe(true);
    expect(text()).not.toMatch(/scheduled|publication|publishes on|will be published|\bedit\b|delete|produce/i);
  });

  it("says when the month holds more contents than are shown", async () => {
    await render([item()], true);
    expect(document.querySelector("[role='status']")?.textContent).toContain("more contents than can be shown");
    await render([item()], false);
    expect(document.querySelector("[role='status']")).toBeNull();
  });

  it("shows empty and loading states", async () => {
    await render([]);
    expect(text()).toContain("No approved content this month");
    await act(async () => root.unmount());
    root = createRoot(container);
    await render(undefined);
    expect(text()).toContain("Loading");
  });
});
