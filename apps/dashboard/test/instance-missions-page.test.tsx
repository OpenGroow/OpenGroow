/** @vitest-environment jsdom */

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { manifestFixture, serveProjectManifests, useQueryWithTemplates } from "./fixtures/manifests";
import { InstanceMissionsContent } from "../src/components/instance-missions-page";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const useQueryMock = vi.fn();
const useMutationMock = vi.fn();
const usePaginatedQueryMock = vi.fn();

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
  usePaginatedQuery: (...args: unknown[]) => usePaginatedQueryMock(...args),
}));

vi.mock("@convex/_generated/api", () => ({
  api: {
    project_templates: {
      listForProject: "project_templates.listForProject",
      getForProject: "project_templates.getForProject",
    },
    project_agents: {
      listByInstance: "project_agents.listByInstance",
    },
    missions: {
      listActiveByInstance: "missions.listActiveByInstance",
      listDoneByInstance: "missions.listDoneByInstance",
      create: "missions.create",
    },
  },
}));

describe("InstanceMissionsContent — mission list", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    useQueryMock.mockReset();
    useMutationMock.mockReset();
    useMutationMock.mockReturnValue(vi.fn());
    usePaginatedQueryMock.mockReset();
    usePaginatedQueryMock.mockReturnValue({ results: [], status: "Exhausted", loadMore: vi.fn() });

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
  const videoManifest = manifestFixture("video-demo");
  const allManifests = [seoManifest, videoManifest];

  async function render(manifests = allManifests) {
    serveProjectManifests(manifests);
    await act(async () => {
      root.render(<InstanceMissionsContent instanceId="instance-1" />);
    });
  }

  function makeMission(overrides: Partial<{
    status: string;
    /** Pass false to omit external.id (simulates unmigrated legacy shape) */
    withExternalId: boolean;
  }> = {}) {
    const { status = "to_validate", withExternalId = true } = overrides;
    return {
      _id: "mission-1",
      type: "create_article",
      status,
      templateId: "@opengroow/seo",
      updatedAt: Date.now(),
      createdAt: Date.now(),
      lastResult: {
        status: "needs_human_review",
        summary: "Article ready",
        reviewQuestions: [],
        artifact: withExternalId
          ? {
              kind: "markdown",
              external: { service: "article-mcp", id: "art-123" },
              metadata: { keyword: "SEO tips" },
            }
          : { metadata: { keyword: "SEO tips" } },
      },
    };
  }

  it("titles the page Missions and never says 'Instance'", async () => {
    useQueryMock.mockImplementation((key: string) => {
      if (key === "missions.listActiveByInstance") return [];
      if (key === "project_agents.listByInstance") return [];
      return undefined;
    });

    await render();

    expect(document.querySelector("h1")?.textContent).toBe("Missions");
    expect(document.body.textContent).not.toContain("Instance");
  });

  it("shows Kanban board with 6 columns", async () => {
    useQueryMock.mockImplementation((key: string) => {
      if (key === "missions.listActiveByInstance") return [];
      if (key === "project_agents.listByInstance") return [];
      return undefined;
    });

    await render();

    const cols = document.body.querySelectorAll("[data-column]");
    expect(cols.length).toBe(6);
  });

  it("places to_validate mission in 'To validate' column", async () => {
    useQueryMock.mockImplementation((key: string) => {
      if (key === "missions.listActiveByInstance") return [makeMission()];
      if (key === "project_agents.listByInstance") return [];
      return undefined;
    });

    await render();

    const col = document.body.querySelector("[data-column='to_validate']");
    expect(col?.textContent).toContain("Create Article");
  });

  it("shows review link for to_validate missions with artifact.external.id (strict contract)", async () => {
    useQueryMock.mockImplementation((key: string) => {
      if (key === "missions.listActiveByInstance") return [makeMission()];
      if (key === "project_agents.listByInstance") return [];
      return undefined;
    });

    await render();

    const links = Array.from(document.querySelectorAll("a"));
    const reviewLink = links.find((a) => a.href.includes("/missions/") && a.href.includes("/review"));
    expect(reviewLink).toBeTruthy();
    expect(reviewLink?.href).toContain("/projects/");
    expect(reviewLink?.href).toContain("/missions/mission-1/review");
  });

  it("does not show review link for to_validate missions without external.id (unmigrated legacy shape)", async () => {
    useQueryMock.mockImplementation((key: string) => {
      if (key === "missions.listActiveByInstance") return [makeMission({ withExternalId: false })];
      if (key === "project_agents.listByInstance") return [];
      return undefined;
    });

    await render();

    const links = Array.from(document.querySelectorAll("a"));
    const reviewLink = links.find((a) => a.href.includes("/review"));
    expect(reviewLink).toBeFalsy();
  });

  it("places approved mission in 'To publish' column", async () => {
    useQueryMock.mockImplementation((key: string) => {
      if (key === "missions.listActiveByInstance") return [makeMission({ status: "approved" })];
      if (key === "project_agents.listByInstance") return [];
      return undefined;
    });

    await render();

    const col = document.body.querySelector("[data-column='approved']");
    expect(col?.textContent).toContain("Create Article");
  });

  it("shows review link for approved missions with artifact.external.id (strict contract)", async () => {
    useQueryMock.mockImplementation((key: string) => {
      if (key === "missions.listActiveByInstance") return [makeMission({ status: "approved" })];
      if (key === "project_agents.listByInstance") return [];
      return undefined;
    });

    await render();

    const links = Array.from(document.querySelectorAll("a"));
    const reviewLink = links.find((a) => a.href.includes("/missions/") && a.href.includes("/review"));
    expect(reviewLink).toBeTruthy();
    expect(reviewLink?.href).toContain("/projects/");
    expect(reviewLink?.href).toContain("/missions/mission-1/review");
  });

  it("does not show review link for done missions even with artifact.external.id", async () => {
    useQueryMock.mockImplementation((key: string) => {
      if (key === "missions.listActiveByInstance") return [];
      if (key === "project_agents.listByInstance") return [];
      return undefined;
    });
    usePaginatedQueryMock.mockReturnValue({
      results: [makeMission({ status: "done" })],
      status: "Exhausted",
      loadMore: vi.fn(),
    });

    await render();

    const links = Array.from(document.querySelectorAll("a"));
    const reviewLink = links.find((a) => a.href.includes("/review"));
    expect(reviewLink).toBeFalsy();
  });

  it("labels the Agent select with the Template's name, not the OpenClaw agent id", async () => {
    useQueryMock.mockImplementation((key: string) => {
      if (key === "missions.listActiveByInstance") return [];
      if (key === "project_agents.listByInstance") return [
        { templateId: "@opengroow/seo", status: "active", openclawAgentName: "opengroow--seo" },
      ];
      return undefined;
    });

    await render();

    const options = Array.from(document.body.querySelectorAll("option")).map((option) => option.textContent);
    expect(options).toContain(seoManifest.name);
    expect(options).not.toContain("opengroow--seo");
  });

  it("shows an optional Name field in the Create Mission form (auto-derived when blank)", async () => {
    useQueryMock.mockImplementation((key: string) => {
      if (key === "missions.listActiveByInstance") return [];
      if (key === "project_agents.listByInstance") return [
        { templateId: "@opengroow/seo", status: "active", openclawAgentName: "seo" },
      ];
      return undefined;
    });

    await render();

    const nameInput = document.body.querySelector("input[name='name'], input[placeholder*='Name'], input[placeholder*='name']") as HTMLInputElement | null;
    const labels = Array.from(document.querySelectorAll("label, span"));
    const hasNameLabel = labels.some((el) => el.textContent?.toLowerCase().includes("name"));
    expect(hasNameLabel).toBeTruthy();
    // Name is now optional — leaving it blank derives a default from the type + number.
    if (nameInput) {
      expect(nameInput.required).toBe(false);
    }
  });

  it("renders the Mission types of a Template served by the Project as a select", async () => {
    useQueryMock.mockImplementation((key: string) => {
      if (key === "missions.listActiveByInstance") return [];
      if (key === "project_agents.listByInstance") return [
        { templateId: "@opengroow/engagement", status: "active", openclawAgentName: "engagement" },
      ];
      return undefined;
    });

    await render([...allManifests, manifestFixture("engagement")]);

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
    expect(variantSelect?.value).toBe("a");
  });

  it("seeds the Mission type once the Project's manifests arrive after its Agents", async () => {
    useQueryMock.mockImplementation((key: string) => {
      if (key === "missions.listActiveByInstance") return [];
      if (key === "project_agents.listByInstance") return [
        { templateId: "@opengroow/engagement", status: "active", openclawAgentName: "engagement" },
      ];
      return undefined;
    });
    const engageSelect = () =>
      Array.from(document.querySelectorAll("select")).find((select) =>
        Array.from(select.options).some((option) => option.value === "engage"),
      );

    serveProjectManifests(undefined);
    await act(async () => {
      root.render(<InstanceMissionsContent instanceId="instance-1" />);
    });
    expect(engageSelect()).toBeUndefined();
    // No free-text Type input while the manifests load: a submit would skip
    // payload-field validation and could pick a hidden type.
    expect(document.body.textContent).toContain("Loading agents…");
    expect(document.querySelector("form")).toBeNull();

    await render([manifestFixture("engagement")]);
    expect(engageSelect()?.value).toBe("engage");
  });

  it("submits an empty object payload when the optional payload textarea is blank", async () => {
    const createMission = vi.fn();
    useMutationMock.mockReturnValue(createMission);
    useQueryMock.mockImplementation((key: string) => {
      if (key === "missions.listActiveByInstance") return [];
      if (key === "project_agents.listByInstance") return [
        { templateId: "@opengroow/engagement", status: "active", openclawAgentName: "engagement" },
      ];
      return undefined;
    });

    await render([...allManifests, manifestFixture("engagement")]);

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

    expect(createMission).toHaveBeenCalledWith({
      instanceId: "instance-1",
      templateId: "@opengroow/engagement",
      type: "engage",
      payload: {},
      name: "",
    });
  });

  it("submits lym_create_letter_video with both default platforms and the default format in raw JSON", async () => {
    const createMission = vi.fn();
    useMutationMock.mockReturnValue(createMission);
    useQueryMock.mockImplementation((key: string) => {
      if (key === "missions.listActiveByInstance") return [];
      if (key === "project_agents.listByInstance") return [
        { templateId: "@opengroow/video-demo", status: "active", openclawAgentName: "video-demo" },
      ];
      return undefined;
    });

    await render();

    const form = document.querySelector("form") as HTMLFormElement;
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

    expect(createMission).toHaveBeenCalledWith({
      instanceId: "instance-1",
      templateId: "@opengroow/video-demo",
      type: "lym_create_letter_video",
      payload: { platforms: ["tiktok", "instagram"], format: "hook-plus-letter" },
      name: "",
    });
  });

  it("does not offer a Mission type the Agent hides (ADR-053), and starts on the first visible one", async () => {
    const createMission = vi.fn();
    useMutationMock.mockReturnValue(createMission);
    useQueryMock.mockImplementation((key: string) => {
      if (key === "missions.listActiveByInstance") return [];
      if (key === "project_agents.listByInstance") return [
        {
          templateId: "@opengroow/video-demo",
          status: "active",
          openclawAgentName: "video-demo",
          hiddenMissionTypes: ["lym_create_letter_video"],
        },
      ];
      return undefined;
    });

    await render();

    const options = Array.from(document.querySelectorAll("option")).map((o) => (o as HTMLOptionElement).value);
    expect(options).not.toContain("lym_create_letter_video");
    expect(options).toContain("lym_create_marketing_video");

    const typeSelect = Array.from(document.querySelectorAll("select")).find((s) =>
      Array.from(s.options).some((o) => o.value === "lym_create_marketing_video"),
    ) as HTMLSelectElement;
    expect(typeSelect.value).toBe("lym_create_marketing_video");
    expect(createMission).not.toHaveBeenCalled();
  });

  it("shows a no-visible-types state instead of a free-text Type input when the Agent hides every type", async () => {
    useMutationMock.mockReturnValue(vi.fn());
    useQueryMock.mockImplementation((key: string) => {
      if (key === "missions.listActiveByInstance") return [];
      if (key === "project_agents.listByInstance") return [
        {
          templateId: "@opengroow/video-demo",
          status: "active",
          openclawAgentName: "video-demo",
          hiddenMissionTypes: ["lym_create_letter_video", "lym_create_marketing_video", "create_chat_mock_video"],
        },
      ];
      return undefined;
    });

    await render();

    expect(document.body.textContent).toContain("Every Mission type of this agent is hidden");
    expect(document.querySelector("input[placeholder='e.g. seo.audit']")).toBeNull();
    const submit = document.querySelector("button[type='submit']") as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
  });

  it("renders labeled inputs (not a raw JSON textarea) when the selected mission type declares fields (issue #300)", async () => {
    useQueryMock.mockImplementation((key: string) => {
      if (key === "missions.listActiveByInstance") return [];
      if (key === "project_agents.listByInstance") return [
        { templateId: "@opengroow/video-demo", status: "active", openclawAgentName: "video-demo" },
      ];
      return undefined;
    });

    await render();

    // Select lym_create_marketing_video, the type that declares a fields schema.
    const selects = Array.from(document.querySelectorAll("select"));
    const missionTypeSelect = selects.find((s) =>
      Array.from(s.options).some((o) => o.value === "lym_create_marketing_video"),
    ) as HTMLSelectElement;
    const nativeSelectValueSetter = Object.getOwnPropertyDescriptor(
      HTMLSelectElement.prototype,
      "value",
    )?.set;
    await act(async () => {
      nativeSelectValueSetter?.call(missionTypeSelect, "lym_create_marketing_video");
      missionTypeSelect.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(document.querySelector("textarea")).toBeNull();
    const labels = Array.from(document.querySelectorAll("label")).map((l) => l.textContent);
    expect(labels.some((l) => l?.includes("Category"))).toBe(true);
    expect(labels.some((l) => l?.includes("Occasion"))).toBe(true);
  });

  it("blocks submission with an error when a required field is missing for lym_create_marketing_video", async () => {
    const createMission = vi.fn();
    useMutationMock.mockReturnValue(createMission);
    useQueryMock.mockImplementation((key: string) => {
      if (key === "missions.listActiveByInstance") return [];
      if (key === "project_agents.listByInstance") return [
        { templateId: "@opengroow/video-demo", status: "active", openclawAgentName: "video-demo" },
      ];
      return undefined;
    });

    await render();

    const selects = Array.from(document.querySelectorAll("select"));
    const missionTypeSelect = selects.find((s) =>
      Array.from(s.options).some((o) => o.value === "lym_create_marketing_video"),
    ) as HTMLSelectElement;
    const nativeSelectValueSetter = Object.getOwnPropertyDescriptor(
      HTMLSelectElement.prototype,
      "value",
    )?.set;
    await act(async () => {
      nativeSelectValueSetter?.call(missionTypeSelect, "lym_create_marketing_video");
      missionTypeSelect.dispatchEvent(new Event("change", { bubbles: true }));
    });

    const form = document.querySelector("form") as HTMLFormElement;
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

    expect(createMission).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("category");
  });
});
