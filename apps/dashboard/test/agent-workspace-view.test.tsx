/** @vitest-environment jsdom */

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentWorkspaceView } from "../src/components/agent-workspace-view";
import { manifestFixture, serveProjectManifests, useQueryWithTemplates } from "./fixtures/manifests";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const useQueryMock = vi.fn();

vi.mock("convex/react", () => ({ useQuery: (...args: unknown[]) => useQueryWithTemplates(useQueryMock)(...args) }));
vi.mock("@convex/_generated/api", () => ({
  api: {
    project_templates: {
      listForProject: "project_templates.listForProject",
      getForProject: "project_templates.getForProject",
    },
    project_agents: { listByInstance: "project_agents.listByInstance" },
  },
}));
vi.mock("@/src/hooks/use-authenticated-instances", () => ({
  useAuthenticatedInstances: () => [{ _id: "rec-1", jobId: "job-1", status: "ready", openclawId: "instance-1" }],
}));

describe("AgentWorkspaceView", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    useQueryMock.mockReset();
    serveProjectManifests([manifestFixture("video-demo")]);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  async function render() {
    await act(async () => {
      root.render(
        <AgentWorkspaceView instanceId="instance-1" templateId="@opengroow/video-demo">
          {(params) => <WorkspaceProbe params={params} />}
        </AgentWorkspaceView>,
      );
    });
  }

  function WorkspaceProbe({ params }: { params: Promise<{ projectId: string; workspaceKey: string }> }) {
    const { projectId, workspaceKey } = React.use(params);
    return <p data-testid="probe">{`${projectId}:${workspaceKey}`}</p>;
  }

  it("hands the Agent's workspaceKey to the page it wraps", async () => {
    useQueryMock.mockReturnValue([{ templateId: "@opengroow/video-demo", status: "active", workspaceKey: "ws-video", mcpServerKeys: [] }]);
    await render();
    await act(async () => {});
    expect(document.querySelector("[data-testid='probe']")?.textContent).toBe("instance-1:ws-video");
  });

  it("keeps ids containing percent-escape-looking text intact for pages that decode their params", async () => {
    useQueryMock.mockReturnValue([{ templateId: "@opengroow/video-demo", status: "active", workspaceKey: "ws-100%25", mcpServerKeys: [] }]);
    await render();
    await act(async () => {});
    const [projectId, workspaceKey] = (document.querySelector("[data-testid='probe']")?.textContent ?? "").split(":");
    // The wrapped pages decode once: they must get back the original key.
    expect(decodeURIComponent(projectId)).toBe("instance-1");
    expect(decodeURIComponent(workspaceKey)).toBe("ws-100%25");
  });

  it("does not open the workspace of a deactivated Agent that kept its workspaceKey", async () => {
    useQueryMock.mockReturnValue([{ templateId: "@opengroow/video-demo", status: "inactive", workspaceKey: "ws-video", mcpServerKeys: [] }]);
    await render();
    expect(document.querySelector("[data-testid='probe']")).toBeNull();
    expect(document.body.textContent).toContain("Activate this Agent");
  });

  it("explains there is nothing to show while the Agent has no workspace", async () => {
    useQueryMock.mockReturnValue([{ templateId: "@opengroow/video-demo", status: "inactive", mcpServerKeys: [] }]);
    await render();
    expect(document.querySelector("[data-testid='probe']")).toBeNull();
    expect(document.body.textContent).toContain("Activate this Agent");
  });
});
