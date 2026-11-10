/** @vitest-environment jsdom */

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectOverviewPage } from "../src/components/project-overview-page";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const useAuthenticatedInstancesMock = vi.fn();

vi.mock("convex/react", () => ({
  // Both Overview queries stay loading: the notice does not depend on them.
  useQuery: () => undefined,
}));
vi.mock("@convex/_generated/api", () => ({
  api: {
    project_overview: { projectOverview: "project_overview.projectOverview" },
    project_agents: { listByInstance: "project_agents.listByInstance" },
  },
}));
vi.mock("@/src/hooks/use-project-manifests", () => ({
  useProjectManifests: () => ({ manifests: [] }),
}));
vi.mock("@/src/hooks/use-authenticated-instances", () => ({
  useAuthenticatedInstances: () => useAuthenticatedInstancesMock(),
}));

const provider = {
  kind: "apikey" as const,
  provider: "openai",
  model: "openai/gpt-5",
  inUse: true,
  updatedAt: "2026-11-10T00:00:00.000Z",
};

describe("ProjectOverviewPage provider notice", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  async function renderWith(instances: unknown) {
    useAuthenticatedInstancesMock.mockReturnValue(instances);
    await act(async () => root.render(<ProjectOverviewPage projectId="project-1" />));
    return container.querySelector('[data-testid="no-provider-notice"]');
  }

  it("asks to add a provider and links to Settings → Providers when none is set up", async () => {
    const notice = await renderWith([{ _id: "i1", jobId: "job-1", openclawId: "project-1", status: "ready", providers: [] }]);
    expect(notice?.textContent).toContain("Add an AI provider");
    expect(notice?.querySelector("a")?.getAttribute("href")).toBe("/projects/project-1/settings/providers");
  });

  it("stays hidden once a provider is set up", async () => {
    const notice = await renderWith([
      { _id: "i1", jobId: "job-1", openclawId: "project-1", status: "ready", providers: [provider] },
    ]);
    expect(notice).toBeNull();
  });

  it("stays hidden while the Project is loading", async () => {
    expect(await renderWith(undefined)).toBeNull();
  });
});
