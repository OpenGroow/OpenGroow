/** @vitest-environment jsdom */

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ProjectLayout from "../app/(app)/projects/[projectId]/layout";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const useActionMock = vi.fn();
const useMutationMock = vi.fn();
const useAuthenticatedInstancesMock = vi.fn();

vi.mock("next/navigation", () => ({
  usePathname: () => "/projects/project-1/brand",
}));

vi.mock("convex/react", () => ({
  useAction: (...args: unknown[]) => useActionMock(...args),
  useMutation: (...args: unknown[]) => useMutationMock(...args),
}));

vi.mock("@convex/_generated/api", () => ({
  api: {
    instances_node: {
      getOpenClawStatus: "instances_node.getOpenClawStatus",
      getOpenClawLogs: "instances_node.getOpenClawLogs",
    },
    instances: {
      renameInstance: "instances.renameInstance",
    },
  },
}));

vi.mock("@/src/hooks/use-authenticated-instances", () => ({
  useAuthenticatedInstances: () => useAuthenticatedInstancesMock(),
}));

describe("Project layout navigation", () => {
  let container: HTMLDivElement;
  let root: Root;

  async function renderLayout() {
    await act(async () => {
      root.render(
        <ProjectLayout params={Promise.resolve({ projectId: "project-1" })}>
          <div />
        </ProjectLayout>,
      );
    });
  }

  beforeEach(() => {
    useActionMock.mockReturnValue(vi.fn());
    useMutationMock.mockReturnValue(vi.fn());
    useAuthenticatedInstancesMock.mockReturnValue([
      {
        jobId: "job-1",
        status: "running",
        runtimeStatus: "linked",
        runtimeReady: true,
        openclawId: "project-1",
        openclawName: "Project One",
        authProvider: { linked: true },
        whatsAppChannel: { linked: true },
      },
    ]);

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

  it("links to the project's Developer route instead of Logs", async () => {
    await act(async () => {
      root.render(
        <ProjectLayout params={Promise.resolve({ projectId: "project-1" })}>
          <div />
        </ProjectLayout>,
      );
    });

    const links = Array.from(container.querySelectorAll("a"));
    const developerLink = links.find((link) => link.textContent?.trim() === "Developer");
    expect(developerLink?.getAttribute("href")).toBe("/projects/project-1/developer");
    expect(links.some((link) => link.textContent?.trim() === "Logs")).toBe(false);
  });

  it("shows Sources and Jobs instead of Observations (issue #536)", async () => {
    await act(async () => {
      root.render(
        <ProjectLayout params={Promise.resolve({ projectId: "project-1" })}>
          <div />
        </ProjectLayout>,
      );
    });

    const labels = Array.from(container.querySelectorAll("a")).map((link) => link.textContent?.trim());
    expect(labels).toContain("Sources");
    expect(labels).toContain("Jobs");
    expect(labels).not.toContain("Observations");
  });

  it("has a single Settings entry instead of the individual settings pages", async () => {
    await act(async () => {
      root.render(
        <ProjectLayout params={Promise.resolve({ projectId: "project-1" })}>
          <div />
        </ProjectLayout>,
      );
    });

    const nav = container.querySelector('nav[aria-label="Project sections"]') as HTMLElement;
    const links = Array.from(nav.querySelectorAll("a"));
    expect(links.map((a) => a.textContent?.trim())).toEqual([
      "Overview",
      "Strategic Memory",
      "Content Plans",
      "Editorial Calendar",
      "Sources",
      "Creative Library",
      "Recipes",
      "Missions",
      "Jobs",
      "Scheduler",
      "Publishing",
      "Analytics",
      "Brand",
      "Agents",
      "Settings",
      "Developer",
    ]);
    expect(links.find((a) => a.textContent?.trim() === "Settings")?.getAttribute("href")).toBe(
      "/projects/project-1/settings",
    );
  });

  it("groups the entries under labelled sections, Overview standing alone above them", async () => {
    await renderLayout();
    const nav = container.querySelector('nav[aria-label="Project sections"]') as HTMLElement;
    const overview = nav.querySelector(":scope > a");
    expect(overview?.textContent?.trim()).toBe("Overview");

    const groups = Array.from(nav.querySelectorAll('[role="group"]'));
    const sections = groups.map((group) => ({
      label: group.getAttribute("aria-label"),
      heading: group.querySelector("[data-nav-heading]")?.textContent?.trim(),
      items: Array.from(group.querySelectorAll("a")).map((a) => a.textContent?.trim()),
    }));
    expect(sections).toEqual([
      { label: "Strategy", heading: "Strategy", items: ["Strategic Memory", "Content Plans", "Editorial Calendar"] },
      { label: "Creative", heading: "Creative", items: ["Sources", "Creative Library", "Recipes"] },
      { label: "Operations", heading: "Operations", items: ["Missions", "Jobs", "Scheduler"] },
      { label: "Distribution", heading: "Distribution", items: ["Publishing", "Analytics"] },
      { label: "Configuration", heading: "Configuration", items: ["Brand", "Agents", "Settings", "Developer"] },
    ]);
  });

  it("marks only the current page's link as active", async () => {
    await renderLayout();
    const nav = container.querySelector('nav[aria-label="Project sections"]') as HTMLElement;
    const current = Array.from(nav.querySelectorAll('a[aria-current="page"]'));
    expect(current.map((a) => a.textContent?.trim())).toEqual(["Brand"]);
  });

  it("collapsed sidebar keeps icon links with titles and hides the section headings", async () => {
    await renderLayout();
    const toggle = container.querySelector('[aria-label="Collapse sidebar"]') as HTMLElement;
    await act(async () => {
      toggle.click();
    });
    const nav = container.querySelector('nav[aria-label="Project sections"]') as HTMLElement;
    const headings = Array.from(nav.querySelectorAll("[data-nav-heading]"));
    expect(headings).toHaveLength(5);
    expect(headings.every((h) => h.className.includes("xl:hidden"))).toBe(true);
    const missions = Array.from(nav.querySelectorAll("a")).find((a) => a.textContent?.trim() === "Missions");
    expect(missions?.getAttribute("title")).toBe("Missions");
  });

  it("has no rename pencil: the project name is edited on the Settings Overview tab", async () => {
    await act(async () => {
      root.render(
        <ProjectLayout params={Promise.resolve({ projectId: "project-1" })}>
          <div />
        </ProjectLayout>,
      );
    });

    expect(container.querySelector('[aria-label="Rename project"]')).toBeNull();
  });
});
