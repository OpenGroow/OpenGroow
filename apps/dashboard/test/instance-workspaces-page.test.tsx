/** @vitest-environment jsdom */

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { manifestFixture, serveProjectManifests, useQueryWithTemplates } from "./fixtures/manifests";
import { InstanceWorkspacesPage } from "../src/components/instance-workspaces-page";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const useQueryMock = vi.fn();
const useActionMock = vi.fn();
const useAuthenticatedInstancesMock = vi.fn();

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));
vi.mock("convex/react", () => ({
  useQuery: (...args: unknown[]) => useQueryWithTemplates(useQueryMock)(...args),
  useAction: (...args: unknown[]) => useActionMock(...args),
}));
vi.mock("@convex/_generated/api", () => ({
  api: {
    project_templates: {
      listForProject: "project_templates.listForProject",
      getForProject: "project_templates.getForProject",
    },
    project_agents: { listByInstance: "project_agents.listByInstance" },
    workspace_operations_node: { listWorkspaces: "workspace_operations_node.listWorkspaces" },
  },
}));
vi.mock("@/src/hooks/use-authenticated-instances", () => ({
  useAuthenticatedInstances: () => useAuthenticatedInstancesMock(),
}));

const workspace = (workspaceKey: string, label: string, kind: string) => ({
  workspaceKey,
  label,
  kind,
  absolutePath: `/workspace/${workspaceKey}`,
  isActive: false,
  availableFiles: [],
});

describe("InstanceWorkspacesPage", () => {
  let container: HTMLDivElement;
  let root: Root;
  const video = manifestFixture("video-demo");
  serveProjectManifests([video]);

  beforeEach(async () => {
    useQueryMock.mockReset();
    useActionMock.mockReset();
    useActionMock.mockReturnValue(() => new Promise(() => {}));
    useQueryMock.mockReturnValue([
      { templateId: "@opengroow/video-demo", status: "active", workspaceKey: "ws-video", mcpServerKeys: [] },
    ]);
    useAuthenticatedInstancesMock.mockReturnValue([
      {
        _id: "rec-1",
        jobId: "job-1",
        status: "ready",
        openclawId: "instance-1",
        workspaceList: {
          workspaces: [
            workspace("ws-video", "video-workspace", "managed"),
            workspace("ws-profile", "Profile workspace", "profile"),
          ],
        },
      },
    ]);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root.render(
        <InstanceWorkspacesPage params={Promise.resolve({ instanceId: "instance-1" })} />,
      );
    });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  function card(title: string): HTMLElement {
    const row = Array.from(document.querySelectorAll("li")).find((el) => el.textContent?.includes(title));
    return row as HTMLElement;
  }

  it("sends a managed workspace to its Agent's Files, titled with the Agent's name", async () => {
    const managed = card(video.name);
    expect(managed.querySelector("a")?.getAttribute("href")).toBe("/projects/instance-1/agents/%40opengroow%2Fvideo-demo/files");
    expect(managed.querySelector("a")?.textContent).toContain(video.name);
  });

  it("does not link a managed workspace while the Agents are still loading", async () => {
    useQueryMock.mockReturnValue(undefined);
    await act(async () => {
      root.render(
        <InstanceWorkspacesPage params={Promise.resolve({ instanceId: "instance-1" })} />,
      );
    });

    const managed = card("video-workspace");
    expect(managed.querySelector("a")).toBeNull();
    expect(managed.querySelector("[aria-disabled='true']")?.textContent).toContain("video-workspace");
    // The other kinds never depend on the Agents.
    expect(card("Profile workspace").querySelector("a")?.getAttribute("href")).toBe(
      "/projects/instance-1/settings/workspaces/ws-profile",
    );
  });

  it("keeps a read-only workspace detail for the other kinds", async () => {
    const other = card("Profile workspace");
    expect(other.querySelector("a")?.getAttribute("href")).toBe("/projects/instance-1/settings/workspaces/ws-profile");
  });
});
