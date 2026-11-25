/** @vitest-environment jsdom */

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InstanceJobsContent } from "../src/components/instance-jobs-page";

// jsdom has no PointerEvent, which the Checkbox primitive dispatches on click.
globalThis.PointerEvent ??= MouseEvent as typeof PointerEvent;

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const useQueryMock = vi.fn();
const mutations: Record<string, ReturnType<typeof vi.fn>> = {
  "jobs.pause": vi.fn(),
  "jobs.resume": vi.fn(),
  "jobs.runNow": vi.fn(),
  "jobs.setFrequency": vi.fn(),
  "strategic_review_jobs.setAnalysisDays": vi.fn(),
  "content_planning_jobs.setConfig": vi.fn(),
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
    strategic_review_jobs: { setAnalysisDays: "strategic_review_jobs.setAnalysisDays" },
    content_planning_jobs: { setConfig: "content_planning_jobs.setConfig", options: "content_planning_jobs.options" },
    source_routing: { setReviewMode: "source_routing.setReviewMode" },
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

const planningOptions = { formats: ["image", "video"], publishTargets: ["social:example", "blog:example"] };
  async function render(jobs: unknown) {
    useQueryMock.mockImplementation((ref: string) =>
      ref === "jobs.listByInstance" ? jobs : ref === "content_planning_jobs.options" ? planningOptions : [],
    );
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

  it("hides the last outcome of an earlier execution while the job is running", async () => {
    await render([makeJob({ lastOutcome: "failed", lastError: "Still invalid after 3 tries", running: true })]);
    const text = document.body.textContent ?? "";
    expect(text).toContain("Running");
    expect(text).not.toContain("Last outcome");
    expect(text).not.toContain("Still invalid after 3 tries");
    expect(document.querySelector('[role="alert"]')).toBeNull();
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

  describe("Strategic review analysis period", () => {
    const review = (config?: unknown) =>
      makeJob({ type: "strategic_review", label: "Strategic review", agentName: "Strategy", config });

    async function openPeriodForm() {
      await openMenu();
      await click(
        Array.from(document.querySelectorAll('[role="menuitem"]')).find((i) => i.textContent === "Edit analysis period"),
      );
    }
    async function setDays(value: string) {
      const el = document.querySelector('[name="analysisDays"]') as HTMLInputElement;
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, value);
        el.dispatchEvent(new Event("input", { bubbles: true }));
      });
    }

    it("shows the period, 30 days by default, next to the schedule", async () => {
      await render([review({})]);
      expect(document.body.textContent).toContain("Analyzes the last 30 days");
    });

    it("shows the configured period", async () => {
      await render([review({ analysisDays: 90 })]);
      expect(document.body.textContent).toContain("Analyzes the last 90 days");
    });

    it("offers no period for other job types", async () => {
      await render([makeJob()]);
      expect(document.body.textContent).not.toContain("Analyzes the last");
      await openMenu();
      expect(document.body.textContent).not.toContain("Edit analysis period");
    });

    it("saves a new period without touching the schedule", async () => {
      await render([review({ analysisDays: 90 })]);
      await openPeriodForm();
      expect((document.querySelector('[name="analysisDays"]') as HTMLInputElement).value).toBe("90");
      await setDays("14");
      await click(button("Save"));
      expect(mutations["strategic_review_jobs.setAnalysisDays"]).toHaveBeenCalledWith({ jobId: "job-1", analysisDays: 14 });
      expect(mutations["jobs.setFrequency"]).not.toHaveBeenCalled();
    });

    it.each(["0", "366", "1.5", ""])("refuses %j with a clear message", async (value) => {
      await render([review()]);
      await openPeriodForm();
      await setDays(value);
      await click(button("Save"));
      expect(mutations["strategic_review_jobs.setAnalysisDays"]).not.toHaveBeenCalled();
      expect(document.body.textContent).toContain("Enter a whole number of days between 1 and 365.");
    });

    it("shows a server refusal", async () => {
      mutations["strategic_review_jobs.setAnalysisDays"]!.mockRejectedValue(new Error("Forbidden"));
      await render([review()]);
      await openPeriodForm();
      await click(button("Save"));
      expect(document.querySelector('[role="alert"]')).not.toBeNull();
    });
  });
  describe("Content planning configuration", () => {
    const planning = (config?: unknown, overrides: Record<string, unknown> = {}) =>
      makeJob({ type: "content_planning", label: "Content planning", agentName: "Strategy", config, ...overrides });

    async function openForm() {
      await openMenu();
      await click(Array.from(document.querySelectorAll('[role="menuitem"]')).find((i) => i.textContent === "Edit planning targets"));
    }
    async function type(name: string, value: string) {
      const el = document.querySelector(`[name="${name}"]`) as HTMLInputElement;
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, value);
        el.dispatchEvent(new Event("input", { bubbles: true }));
      });
    }
    const check = (id: string) => click(document.querySelector(`[data-testid="${id}"]`)!);

    it("shows the horizon and the targets next to the schedule, 7 days and no target by default", async () => {
      await render([planning({})]);
      expect(document.body.textContent).toContain("Plans the next 7 days");
      expect(document.body.textContent).toContain("No production targets");
    });

    it("summarizes the configured targets", async () => {
      await render([planning({ planningDays: 14, productionTargets: [{ kind: "video", quantity: 3, publishTargets: ["social:example"] }] })]);
      expect(document.body.textContent).toContain("Plans the next 14 days");
      expect(document.body.textContent).toContain("3 video");
    });

    it("offers the formats of the Project and saves quantities and Publish targets", async () => {
      await render([planning({})]);
      await openForm();
      expect(document.querySelector('[data-testid="format-video"]')).not.toBeNull();
      expect(document.querySelector('[data-testid="format-image"]')).not.toBeNull();
      expect(document.querySelector('[data-testid="format-article"]')).toBeNull();
      await type("planningDays", "14");
      await check("format-video");
      await type("quantity-video", "4");
      await check("target-video-social:example");
      await click(button("Save"));
      expect(mutations["content_planning_jobs.setConfig"]).toHaveBeenCalledWith({
        jobId: "job-1",
        planningDays: 14,
        productionTargets: [{ kind: "video", quantity: 4, publishTargets: ["social:example"] }],
      });
    });

    it.each(["0", "61", "1.5", ""])("refuses a horizon of %j before calling the server", async (value) => {
      await render([planning({})]);
      await openForm();
      await type("planningDays", value);
      await click(button("Save"));
      expect(mutations["content_planning_jobs.setConfig"]).not.toHaveBeenCalled();
      expect(document.body.textContent).toContain("The planning horizon must be a whole number of days between 1 and 60.");
    });

    it("refuses a total above 100 and a format without Publish target", async () => {
      await render([planning({})]);
      await openForm();
      await check("format-video");
      await type("quantity-video", "101");
      await check("target-video-social:example");
      await click(button("Save"));
      expect(document.body.textContent).toContain("it may not exceed 100");
      await type("quantity-video", "2");
      await check("target-video-social:example");
      await click(button("Save"));
      expect(document.body.textContent).toContain("Choose at least one Publish target");
      expect(mutations["content_planning_jobs.setConfig"]).not.toHaveBeenCalled();
    });

    it("shows a server refusal", async () => {
      mutations["content_planning_jobs.setConfig"]!.mockRejectedValue(new Error("Forbidden"));
      await render([planning({})]);
      await openForm();
      await click(button("Save"));
      expect(document.querySelector('[role="alert"]')).not.toBeNull();
    });

    it("keeps the recurrence controls and offers nothing of the kind to other jobs", async () => {
      await render([planning({})]);
      await openMenu();
      expect(document.body.textContent).toContain("Edit recurrence");
      await render([makeJob()]);
      await openMenu();
      expect(document.body.textContent).not.toContain("Edit planning targets");
    });

    it("says why a Run Now was skipped", async () => {
      await render([planning({}, { lastOutcome: "skipped", lastSummary: "no production targets configured" })]);
      expect(document.body.textContent).toContain("Skipped — no production targets configured");
    });
  });
});
