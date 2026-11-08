/** @vitest-environment jsdom */

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CheckTemplateUpdatesButton, TemplateUpdatesPanel } from "../src/components/template-updates-panel";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const useQueryMock = vi.fn();
const applyUpdateMock = vi.fn();
const checkHubUpdatesMock = vi.fn(async (): Promise<{ offered: Array<{ templateId: string; version: string }>; error?: string }> => ({ offered: [] }));

vi.mock("convex/react", () => ({
  useQuery: (...args: unknown[]) => useQueryMock(...args),
  useMutation: () => applyUpdateMock,
  useAction: () => checkHubUpdatesMock,
}));

vi.mock("@convex/_generated/api", () => ({
  api: {
    project_templates: { updates: "project_templates.updates", applyUpdate: "project_templates.applyUpdate" },
    project_templates_node: { checkHubUpdates: "project_templates_node.checkHubUpdates" },
  },
}));

import type { UpdatePlan } from "@convex/template_manifest_contract";

const emptyPlan: UpdatePlan = {
  fromVersion: "1.0.0",
  toVersion: "2.0.0",
  mcpHosts: { added: [], removed: [], changed: [] },
  newSecrets: [],
  newPlugins: [],
  newSkills: [],
  newRequiredFields: [],
  reactivationFields: [],
  removedMissionTypes: [],
  removedMissionTypesInUse: [],
  requiresAttention: false,
};

const offer = (plan: Partial<UpdatePlan> = {}) => ({
  templateId: "@alice/seo",
  currentVersion: "1.0.0",
  availableVersion: "2.0.0",
  origin: "git",
  plan: { ...emptyPlan, ...plan },
});

describe("TemplateUpdatesPanel", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    applyUpdateMock.mockReset();
    useQueryMock.mockReset();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    document.body.innerHTML = "";
  });

  const render = async () => act(async () => root.render(<TemplateUpdatesPanel projectId="proj" />));
  const click = (el: Element | undefined) =>
    act(async () => {
      el?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
  const button = (text: string) =>
    Array.from(document.querySelectorAll("button")).find((b) => b.textContent?.includes(text));

  it("does not read the hub when shown: only Check for updates does, saying Up to date or why it failed", async () => {
    useQueryMock.mockReturnValue([]);
    checkHubUpdatesMock.mockClear();
    await render();
    expect(checkHubUpdatesMock).not.toHaveBeenCalled();

    checkHubUpdatesMock.mockResolvedValueOnce({ offered: [] });
    await act(async () => root.render(<CheckTemplateUpdatesButton projectId="proj" />));
    await click(button("Check for updates"));
    expect(checkHubUpdatesMock).toHaveBeenCalledWith({ instanceId: "proj" });
    expect(container.textContent).toContain("Up to date");

    checkHubUpdatesMock.mockResolvedValueOnce({ offered: [], error: "offline" });
    await click(button("Check for updates"));
    expect(container.textContent).toContain("offline");
  });

  it("says updates are available when the check offers one, or one was offered before", async () => {
    useQueryMock.mockReturnValue([offer()]);
    checkHubUpdatesMock.mockResolvedValueOnce({ offered: [] });
    await act(async () => root.render(<CheckTemplateUpdatesButton projectId="proj" />));
    await click(button("Check for updates"));
    expect(container.textContent).toContain("Updates available below");
  });

  it("renders nothing when no update is available", async () => {
    useQueryMock.mockReturnValue([]);
    await render();
    expect(container.textContent).toBe("");
  });

  it("announces an available version and applies nothing until the user confirms", async () => {
    useQueryMock.mockReturnValue([
      offer({
        mcpHosts: { added: ["new.example.com"], removed: [], changed: [] },
        newSecrets: [{ key: "token", label: "Token", required: true }],
        removedMissionTypesInUse: [{ type: "audit", schedules: 2 }],
      }),
    ]);
    applyUpdateMock.mockResolvedValue(null);
    await render();
    expect(container.textContent).toContain("Version 2.0.0 of @alice/seo is available");

    await click(button("Review update"));
    const dialog = document.querySelector('[role="dialog"]')!.textContent ?? "";
    expect(dialog).toContain("new.example.com");
    expect(dialog).toContain("Token");
    expect(dialog).toContain("audit (2 Schedules)");
    expect(applyUpdateMock).not.toHaveBeenCalled();

    await click(button("Apply update"));
    expect(applyUpdateMock).toHaveBeenCalledWith({ projectId: "proj", templateId: "@alice/seo", version: "2.0.0" });
  });

  it("cancelling leaves the update unapplied", async () => {
    useQueryMock.mockReturnValue([offer()]);
    await render();
    await click(button("Review update"));
    await click(button("Cancel"));
    expect(applyUpdateMock).not.toHaveBeenCalled();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it("shows the reason when applying fails", async () => {
    useQueryMock.mockReturnValue([offer()]);
    applyUpdateMock.mockRejectedValue(new Error("not offered"));
    await render();
    await click(button("Review update"));
    await click(button("Apply update"));
    expect(document.querySelector('[role="alert"]')?.textContent).toBe("not offered");
  });
});
