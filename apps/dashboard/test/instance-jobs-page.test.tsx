/** @vitest-environment jsdom */

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InstanceJobsContent } from "../src/components/instance-jobs-page";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const useQueryMock = vi.fn();
const mutations: Record<string, ReturnType<typeof vi.fn>> = {
  "jobs.pause": vi.fn(),
  "jobs.resume": vi.fn(),
  "jobs.runNow": vi.fn(),
  "jobs.setFrequency": vi.fn(),
};

vi.mock("convex/react", () => ({
  useQuery: (...args: unknown[]) => useQueryMock(...args),
  useMutation: (ref: string) => mutations[ref],
}));

vi.mock("@convex/_generated/api", () => ({
  api: {
    jobs: {
      listByInstance: "jobs.listByInstance",
      pause: "jobs.pause",
      resume: "jobs.resume",
      runNow: "jobs.runNow",
      setFrequency: "jobs.setFrequency",
    },
  },
}));

function makeJob(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    _id: "job-1",
    type: "source_ingestion",
    label: "Social source ingestion",
    templateId: "@opengroow/engagement",
    agentName: "Social engagement",
    state: "active",
    unit: "daily",
    hour: 6,
    minute: 0,
    timezone: "UTC",
    nextRunAt: Date.UTC(2026, 5, 2, 6, 0),
    running: false,
    ...overrides,
  };
}

describe("InstanceJobsContent", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    useQueryMock.mockReset();
    for (const fn of Object.values(mutations)) fn.mockReset().mockResolvedValue(undefined);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

async function render(jobs: unknown) {
    useQueryMock.mockImplementation((ref: string) => ref === "jobs.listByInstance" ? jobs : []);
    await act(async () => {
      root.render(<InstanceJobsContent instanceId="instance-1" />);
    });
  }

  const button = (label: string) =>
    Array.from(document.querySelectorAll("button")).find((b) => b.textContent?.trim() === label);

  async function click(el: Element | undefined) {
    await act(async () => {
      el!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
  }

  async function openMenu() {
    const trigger = document.querySelector('[aria-label="More actions"]')!;
    await act(async () => {
      for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
        trigger.dispatchEvent(new MouseEvent(type, { bubbles: true, button: 0 }));
      }
    });
  }

  it("shows loading then empty states", async () => {
    await render(undefined);
    expect(document.body.textContent).toContain("Loading");
    await render([]);
    expect(document.body.textContent).toContain("No jobs yet");
  });

  it("lists agent, state, cadence, next run and the last outcome and error", async () => {
    await render([
      makeJob({ lastOutcome: "failed", lastError: "Agent is not active", lastRunAt: Date.UTC(2026, 5, 1, 6, 0) }),
    ]);
    const text = document.body.textContent ?? "";
    expect(text).toContain("Social engagement");
    expect(text).toContain("Daily at 06:00");
    expect(text).toContain("Next run");
    expect(text).toContain("2026");
    expect(text).toContain("Failed");
    expect(text).toContain("Agent is not active");
  });

  it("shows a skipped outcome as skipped, not as an error", async () => {
    await render([makeJob({ lastOutcome: "skipped" })]);
    const text = document.body.textContent ?? "";
    expect(text).toContain("Skipped");
    expect(text).not.toContain("Last outcome: Failed");
    expect(text).toContain("Active");
    expect(document.querySelector('[role="alert"]')).toBeNull();
  });

  it("shows a running execution and a paused job", async () => {
    await render([makeJob({ running: true }), makeJob({ _id: "job-2", state: "paused" })]);
    const text = document.body.textContent ?? "";
    expect(text).toContain("Running");
    expect(text).toContain("Paused");
  });

  it("links a source job to its latest Run logs", async () => {
    await render([makeJob({ workspaceKey: "ws-social", latestRunId: "run-9" })]);
    await openMenu();
    const link = Array.from(document.querySelectorAll("a")).find((a) => a.textContent === "View logs");
    expect(link?.getAttribute("href")).toBe("/projects/instance-1/agents/%40opengroow%2Fengagement/logs?runId=run-9");
  });

  it("does not show logs when the job has never run", async () => {
    await render([makeJob({ workspaceKey: "ws-social" })]);
    await openMenu();
    expect(document.body.textContent).not.toContain("View logs");
  });

  it("filters by status with counts and searches by name", async () => {
    await render([
      makeJob({ running: true }),
      makeJob({ _id: "job-2", label: "Source scoring", agentName: "Source scoring", state: "paused" }),
      makeJob({ _id: "job-3", label: "Source routing", agentName: "Source routing", lastOutcome: "failed" }),
    ]);
    const chips = Array.from(document.querySelectorAll("[aria-pressed]"));
    expect(chips.map((c) => c.textContent)).toEqual(["All3", "Running1", "Paused1", "Failed1"]);
    await click(chips[2]);
    expect(document.body.textContent).toContain("Source scoring");
    expect(document.body.textContent).not.toContain("Source routing");
    await click(chips[0]);
    const search = document.querySelector('input[type="search"]') as HTMLInputElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(search, "zzz");
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(document.body.textContent).toContain("No jobs match");
  });

  it("pauses an active job and resumes a paused one", async () => {
    await render([makeJob(), makeJob({ _id: "job-2", state: "paused" })]);
    await click(button("Pause"));
    expect(mutations["jobs.pause"]).toHaveBeenCalledWith({ jobId: "job-1" });
    await click(button("Resume"));
    expect(mutations["jobs.resume"]).toHaveBeenCalledWith({ jobId: "job-2" });
  });

  it("runs a source job immediately", async () => {
    await render([makeJob()]);
    expect(document.body.textContent).toContain("Run now");
    await click(button("Run now"));
    expect(mutations["jobs.runNow"]).toHaveBeenCalledWith({ jobId: "job-1" });
  });

  it("saves a new weekly recurrence with the browser timezone", async () => {
    await render([makeJob()]);
    await openMenu();
    await click(
      Array.from(document.querySelectorAll('[role="menuitem"]')).find((i) => i.textContent === "Edit recurrence"),
    );

    const setValue = async (name: string, value: string) => {
      const el = document.querySelector(`[name="${name}"]`) as HTMLSelectElement | HTMLInputElement;
      await act(async () => {
        const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value);
        el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
      });
    };
    await setValue("unit", "weekly");
    await setValue("dayOfWeek", "2");
    await setValue("hour", "9");
    await setValue("minute", "30");
    await click(button("Save"));

    expect(mutations["jobs.setFrequency"]).toHaveBeenCalledWith({
      jobId: "job-1",
      frequency: { unit: "weekly", dayOfWeek: 2, hour: 9, minute: 30 },
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    });
  });

  it("links to the job's latest Run in Agent Logs", async () => {
    await render([makeJob({ workspaceKey: "ws-social", latestRunId: "run-9" })]);
    await openMenu();
    const link = Array.from(document.querySelectorAll("a")).find((a) => a.textContent === "View logs");
    expect(link?.getAttribute("href")).toBe("/projects/instance-1/agents/%40opengroow%2Fengagement/logs?runId=run-9");
  });

  it("shows no logs link for a job that has never run", async () => {
    await render([makeJob({ workspaceKey: "ws-social" })]);
    await openMenu();
    expect(document.body.textContent).not.toContain("View logs");
  });
});
