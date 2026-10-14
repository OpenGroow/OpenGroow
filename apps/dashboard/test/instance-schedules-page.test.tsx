/** @vitest-environment jsdom */

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { manifestFixture, serveProjectManifests, useQueryWithTemplates } from "./fixtures/manifests";
import { InstanceSchedulesContent } from "../src/components/instance-schedules-page";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const useQueryMock = vi.fn();
const useMutationMock = vi.fn();

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("convex/react", () => ({
  useQuery: (...args: unknown[]) => useQueryWithTemplates(useQueryMock)(...args),
  useMutation: (...args: unknown[]) => useMutationMock(...args),
}));

vi.mock("@convex/_generated/api", () => ({
  api: {
    project_templates: {
      listForProject: "project_templates.listForProject",
      getForProject: "project_templates.getForProject",
    },
    project_agents: { listByInstance: "project_agents.listByInstance" },
    schedules: {
      listByInstance: "schedules.listByInstance",
      create: "schedules.create",
      pause: "schedules.pause",
      resume: "schedules.resume",
      remove: "schedules.remove",
    },
  },
}));

describe("InstanceSchedulesContent", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    useQueryMock.mockReset();
    useMutationMock.mockReset();
    useMutationMock.mockReturnValue(vi.fn());

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

  const seoManifest = manifestFixture("seo");
  const socialEngagementManifest = manifestFixture("engagement");
  const allManifests = [seoManifest, socialEngagementManifest];

  async function render(manifests = allManifests) {
    serveProjectManifests(manifests);
    await act(async () => {
      root.render(<InstanceSchedulesContent instanceId="instance-1" />);
    });
  }

  function makeSchedule(overrides: Record<string, unknown> = {}) {
    return {
      _id: "schedule-1",
      ownerId: "owner-1",
      instanceId: "instance-1",
      templateId: "@opengroow/seo",
      type: "create_article",
      payload: {},
      unit: "daily",
      hour: 9,
      minute: 0,
      timezone: "Europe/Paris",
      status: "active",
      nextRunAt: Date.UTC(2026, 5, 5, 7, 0, 0),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      ...overrides,
    };
  }

  it("lists a schedule with its type and readable daily cadence", async () => {
    useQueryMock.mockImplementation((key: string) => {
      if (key === "schedules.listByInstance") return [makeSchedule()];
      if (key === "project_agents.listByInstance") return [];
      return undefined;
    });

    await render();

    expect(document.body.textContent).toContain("create_article");
    expect(document.body.textContent).toContain("Daily at 09:00");
  });

  it("shows the next execution for each schedule", async () => {
    useQueryMock.mockImplementation((key: string) => {
      if (key === "schedules.listByInstance") return [makeSchedule()];
      if (key === "project_agents.listByInstance") return [];
      return undefined;
    });

    await render();

    expect(document.body.textContent).toContain("Next run");
  });

  it("renders the create form (with hour/minute) when an active agent exists", async () => {
    useQueryMock.mockImplementation((key: string) => {
      if (key === "schedules.listByInstance") return [];
      if (key === "project_agents.listByInstance")
        return [{ templateId: "@opengroow/seo", openclawAgentName: "seo", status: "active" }];
      return undefined;
    });

    await render();

    const hourInput = document.querySelector('input[name="hour"]');
    const minuteInput = document.querySelector('input[name="minute"]');
    expect(hourInput).toBeTruthy();
    expect(minuteInput).toBeTruthy();
  });

  it("does not offer a Mission type the Agent hides in the schedule form (ADR-053)", async () => {
    useQueryMock.mockImplementation((key: string) => {
      if (key === "schedules.listByInstance") return [];
      if (key === "project_agents.listByInstance")
        return [
          {
            templateId: "@opengroow/video-demo",
            openclawAgentName: "video-demo",
            status: "active",
            hiddenMissionTypes: ["create_chat_mock_video"],
          },
        ];
      return undefined;
    });

    await render([...allManifests, manifestFixture("video-demo")]);

    const options = Array.from(document.querySelectorAll("option")).map((o) => (o as HTMLOptionElement).value);
    expect(options).toContain("lym_create_letter_video");
    expect(options).not.toContain("create_chat_mock_video");
  });

  it("renders the schedule types of a Template served by the Project as a select", async () => {
    useQueryMock.mockImplementation((key: string) => {
      if (key === "schedules.listByInstance") return [];
      if (key === "project_agents.listByInstance")
        return [
          {
            templateId: "@opengroow/engagement",
            openclawAgentName: "engagement",
            status: "active",
          },
        ];
      return undefined;
    });

    await render();

    const selects = Array.from(document.querySelectorAll("select"));
    const typeSelect = selects.find((select) =>
      Array.from(select.options).some((option) => option.value === "engage"),
    );
    expect(typeSelect).toBeTruthy();
    expect(typeSelect?.value).toBe("engage");
    expect(typeSelect?.textContent).toContain("Engage");

    // engage now declares a `fields` schema (issue #352: the variant is chosen
    // per Mission, not frozen on the Agent) — the payload editor renders the
    // generic select-driven form instead of a raw JSON textarea by default.
    expect(document.querySelector("textarea")).toBeFalsy();
    const variantSelect = selects.find((select) =>
      Array.from(select.options).some((option) => option.value === "b"),
    );
    expect(variantSelect).toBeTruthy();
    expect(
      Array.from(variantSelect!.options).map((o) => o.value).sort(),
    ).toEqual(["", "a", "b"]);
    // The engage default payload pre-selects "a".
    expect(variantSelect?.value).toBe("a");
  });

  it("shows the autoPublish toggle for a template/type that supports the full review flow", async () => {
    useQueryMock.mockImplementation((key: string) => {
      if (key === "schedules.listByInstance") return [];
      if (key === "project_agents.listByInstance")
        return [{ templateId: "@opengroow/seo", openclawAgentName: "seo", status: "active" }];
      return undefined;
    });

    await render();

    expect(document.body.textContent).toContain("Auto-publish");
  });

  it("hides the autoPublish toggle for a template/type with no review contract", async () => {
    useQueryMock.mockImplementation((key: string) => {
      if (key === "schedules.listByInstance") return [];
      if (key === "project_agents.listByInstance")
        return [
          {
            templateId: "@opengroow/engagement",
            openclawAgentName: "engagement",
            status: "active",
          },
        ];
      return undefined;
    });

    await render();

    expect(document.body.textContent).not.toContain("Auto-publish");
  });

  it("submits autoPublish:true when the toggle is checked before creating a schedule", async () => {
    const createSchedule = vi.fn();
    useMutationMock.mockReturnValue(createSchedule);
    useQueryMock.mockImplementation((key: string) => {
      if (key === "schedules.listByInstance") return [];
      if (key === "project_agents.listByInstance")
        return [{ templateId: "@opengroow/seo", openclawAgentName: "seo", status: "active" }];
      return undefined;
    });

    await render();

    const checkbox = document.querySelector('input[type="checkbox"]') as HTMLInputElement;
    expect(checkbox).toBeTruthy();
    await act(async () => {
      checkbox.click();
    });

    const form = document.querySelector("form") as HTMLFormElement;
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

    expect(createSchedule).toHaveBeenCalledWith(
      expect.objectContaining({ autoPublish: true }),
    );
  });

  it("does not submit autoPublish when the toggle is left unchecked", async () => {
    const createSchedule = vi.fn();
    useMutationMock.mockReturnValue(createSchedule);
    useQueryMock.mockImplementation((key: string) => {
      if (key === "schedules.listByInstance") return [];
      if (key === "project_agents.listByInstance")
        return [{ templateId: "@opengroow/seo", openclawAgentName: "seo", status: "active" }];
      return undefined;
    });

    await render();

    const form = document.querySelector("form") as HTMLFormElement;
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

    expect(createSchedule).toHaveBeenCalledWith(
      expect.not.objectContaining({ autoPublish: expect.anything() }),
    );
  });

  it("submits an empty object payload when the optional payload textarea is blank", async () => {
    const createSchedule = vi.fn();
    useMutationMock.mockReturnValue(createSchedule);
    useQueryMock.mockImplementation((key: string) => {
      if (key === "schedules.listByInstance") return [];
      if (key === "project_agents.listByInstance")
        return [
          {
            templateId: "@opengroow/engagement",
            openclawAgentName: "engagement",
            status: "active",
          },
        ];
      return undefined;
    });

    await render();

    // engage now declares a `fields` schema (issue #352), so the payload
    // editor defaults to the generic select-driven form — flip to the raw
    // JSON escape hatch to exercise the blank-textarea submission path.
    const rawModeToggle = Array.from(document.querySelectorAll("button")).find(
      (btn) => btn.textContent === "Edit as raw JSON",
    ) as HTMLButtonElement;
    expect(rawModeToggle).toBeTruthy();
    await act(async () => {
      rawModeToggle.click();
    });

    const textarea = document.querySelector("textarea") as HTMLTextAreaElement;
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    )?.set;
    await act(async () => {
      if (nativeInputValueSetter) {
        nativeInputValueSetter.call(textarea, "");
      } else {
        textarea.value = "";
      }
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });

    const form = document.querySelector("form") as HTMLFormElement;
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

    expect(createSchedule).toHaveBeenCalledWith(
      expect.objectContaining({
        instanceId: "instance-1",
        templateId: "@opengroow/engagement",
        type: "engage",
        payload: {},
      }),
    );
  });

  it("shows an empty state when there are no schedules", async () => {
    useQueryMock.mockImplementation((key: string) => {
      if (key === "schedules.listByInstance") return [];
      if (key === "project_agents.listByInstance") return [];
      return undefined;
    });

    await render();

    expect(document.body.textContent).toContain("No schedules yet");
  });

  it("renders a readable weekly cadence in the list", async () => {
    useQueryMock.mockImplementation((key: string) => {
      if (key === "schedules.listByInstance")
        return [makeSchedule({ unit: "weekly", dayOfWeek: 1 })];
      if (key === "project_agents.listByInstance") return [];
      return undefined;
    });

    await render();

    expect(document.body.textContent).toContain("Weekly on Monday at 09:00");
  });

  it("renders a readable monthly cadence in the list", async () => {
    useQueryMock.mockImplementation((key: string) => {
      if (key === "schedules.listByInstance")
        return [makeSchedule({ unit: "monthly", dayOfMonth: 15 })];
      if (key === "project_agents.listByInstance") return [];
      return undefined;
    });

    await render();

    expect(document.body.textContent).toContain("Monthly on day 15 at 09:00");
  });

  function setSelectValue(el: HTMLSelectElement, value: string) {
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLSelectElement.prototype,
      "value",
    )!.set!;
    setter.call(el, value);
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  it("reveals a day-of-week control when the weekly unit is selected", async () => {
    useQueryMock.mockImplementation((key: string) => {
      if (key === "schedules.listByInstance") return [];
      if (key === "project_agents.listByInstance")
        return [{ templateId: "@opengroow/seo", openclawAgentName: "seo", status: "active" }];
      return undefined;
    });

    await render();
    expect(document.querySelector('select[name="dayOfWeek"]')).toBeFalsy();

    const unit = document.querySelector('select[name="unit"]') as HTMLSelectElement;
    expect(unit).toBeTruthy();
    await act(async () => {
      setSelectValue(unit, "weekly");
    });

    expect(document.querySelector('select[name="dayOfWeek"]')).toBeTruthy();
    expect(document.querySelector('input[name="dayOfMonth"]')).toBeFalsy();
  });

  it("displays lastRunAt when the schedule has run before", async () => {
    const lastRunAt = Date.UTC(2026, 5, 3, 9, 0, 0);
    useQueryMock.mockImplementation((key: string) => {
      if (key === "schedules.listByInstance") return [makeSchedule({ lastRunAt })];
      if (key === "project_agents.listByInstance") return [];
      return undefined;
    });

    await render();

    expect(document.body.textContent).toContain("Last run");
  });

  it("displays lastError when the last tick failed", async () => {
    useQueryMock.mockImplementation((key: string) => {
      if (key === "schedules.listByInstance")
        return [makeSchedule({ lastError: "projectAgent for seo is not active" })];
      if (key === "project_agents.listByInstance") return [];
      return undefined;
    });

    await render();

    expect(document.body.textContent).toContain("projectAgent for seo is not active");
  });

  it("links to the last mission when lastMissionId is set", async () => {
    useQueryMock.mockImplementation((key: string) => {
      if (key === "schedules.listByInstance")
        return [makeSchedule({ lastMissionId: "mission-abc" as unknown as string })];
      if (key === "project_agents.listByInstance") return [];
      return undefined;
    });

    await render();

    const link = document.querySelector('[data-testid="last-mission-link"]') as HTMLAnchorElement | null;
    expect(link).toBeTruthy();
    expect(link!.href).toContain("mission-abc");
  });

  it("shows a Pause button (not Resume) for an active schedule", async () => {
    useQueryMock.mockImplementation((key: string) => {
      if (key === "schedules.listByInstance") return [makeSchedule({ status: "active" })];
      if (key === "project_agents.listByInstance") return [];
      return undefined;
    });

    await render();

    expect(document.querySelector('button[data-action="pause"]')).toBeTruthy();
    expect(document.querySelector('button[data-action="resume"]')).toBeFalsy();
    expect(document.querySelector('button[data-action="delete"]')).toBeTruthy();
  });

  it("shows a Resume button (not Pause) for a paused schedule", async () => {
    useQueryMock.mockImplementation((key: string) => {
      if (key === "schedules.listByInstance") return [makeSchedule({ status: "paused" })];
      if (key === "project_agents.listByInstance") return [];
      return undefined;
    });

    await render();

    expect(document.querySelector('button[data-action="resume"]')).toBeTruthy();
    expect(document.querySelector('button[data-action="pause"]')).toBeFalsy();
    expect(document.querySelector('button[data-action="delete"]')).toBeTruthy();
  });

  it("reveals a day-of-month control when the monthly unit is selected", async () => {
    useQueryMock.mockImplementation((key: string) => {
      if (key === "schedules.listByInstance") return [];
      if (key === "project_agents.listByInstance")
        return [{ templateId: "@opengroow/seo", openclawAgentName: "seo", status: "active" }];
      return undefined;
    });

    await render();

    const unit = document.querySelector('select[name="unit"]') as HTMLSelectElement;
    await act(async () => {
      setSelectValue(unit, "monthly");
    });

    expect(document.querySelector('input[name="dayOfMonth"]')).toBeTruthy();
    expect(document.querySelector('select[name="dayOfWeek"]')).toBeFalsy();
  });
});
