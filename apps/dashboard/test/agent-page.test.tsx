/** @vitest-environment jsdom */

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { manifestFixture, serveProjectManifests, useQueryWithTemplates } from "./fixtures/manifests";
import type { AgentManifest } from "@convex/template_manifest_contract";
import { AgentPageLayout, AgentOverview, AgentSettings } from "../src/components/agent-page";
import AgentLayout from "../app/(app)/projects/[projectId]/agents/[templateId]/layout";
import { templateIdFromSegment } from "../src/lib/template-route";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// jsdom has no PointerEvent, which the Checkbox primitive dispatches on click.
globalThis.PointerEvent ??= MouseEvent as typeof PointerEvent;

const notFoundMock = vi.fn(() => {
  throw new Error("NEXT_NOT_FOUND");
});
const useQueryMock = vi.fn();
const useActionMock = vi.fn();
const useMutationMock = vi.fn();
const refreshMock = vi.fn();
const deactivateMock = vi.fn();
const reconfigureMock = vi.fn();
const setHiddenMissionTypesMock = vi.fn();
let pathname = "/projects/instance-1/agents/%40opengroow%2Fvideo-demo";

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
  notFound: () => notFoundMock(),
  usePathname: () => pathname,
}));
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
  useMutation: (...args: unknown[]) => useMutationMock(...args),
}));
vi.mock("@convex/_generated/api", () => ({
  api: {
    project_templates: {
      listForProject: "project_templates.listForProject",
      getForProject: "project_templates.getForProject",
    },
    template_mcp_overrides: {
      listForTemplate: "template_mcp_overrides.listForTemplate",
      set: "template_mcp_overrides.set",
      clear: "template_mcp_overrides.clear",
    },
    missions: { overviewByTemplate: "missions.overviewByTemplate" },
    project_agents: {
      listByInstance: "project_agents.listByInstance",
      setHiddenMissionTypes: "project_agents.setHiddenMissionTypes",
    },
    project_agents_node: {
      deactivateProjectAgent: "project_agents_node.deactivateProjectAgent",
      refreshProjectAgent: "project_agents_node.refreshProjectAgent",
      reconfigureProjectAgent: "project_agents_node.reconfigureProjectAgent",
    },
  },
}));
vi.mock("@/src/hooks/use-authenticated-instances", () => ({
  useAuthenticatedInstances: () => [{ _id: "rec-1", jobId: "job-1", status: "ready", openclawId: "instance-1" }],
}));

function manifestOf(id: string): AgentManifest {
  return manifestFixture(id);
}

function button(text: string): HTMLButtonElement | undefined {
  return Array.from(document.querySelectorAll("button")).find((b) => b.textContent?.includes(text));
}

function tab(label: string): Element | undefined {
  return Array.from(document.querySelectorAll("nav a, nav [aria-disabled='true']")).find(
    (el) => el.textContent?.trim() === label,
  );
}

describe("agents/[templateId] route segment", () => {
  it("returns 404 when the templateId segment is not valid percent-encoding", async () => {
    await expect(
      AgentLayout({ params: Promise.resolve({ projectId: "instance-1", templateId: "100%" }), children: null }),
    ).rejects.toThrow("NEXT_NOT_FOUND");
    expect(() => templateIdFromSegment("%E0%A4%A")).toThrow("NEXT_NOT_FOUND");
  });

  it("decodes a valid segment", () => {
    expect(templateIdFromSegment("video-demo")).toBe("video-demo");
    expect(templateIdFromSegment("a%20b")).toBe("a b");
  });
});

describe("Agent page", () => {
  let container: HTMLDivElement;
  let root: Root;

  const NO_MISSIONS = { recent: [], counts: { doing: 0, toValidate: 0, failed: 0 }, truncated: false };
  let overview: Record<string, unknown> = NO_MISSIONS;

  function agents(...records: Array<Record<string, unknown>>) {
    const rows = records.map((r) => ({ mcpServerKeys: [], ...r }));
    useQueryMock.mockImplementation((query: string) =>
      query === "missions.overviewByTemplate" ? overview : rows,
    );
  }

  async function render(node: React.ReactNode) {
    await act(async () => root.render(node));
  }

  beforeEach(() => {
    overview = NO_MISSIONS;
    for (const m of [useQueryMock, useActionMock, useMutationMock, refreshMock, deactivateMock, reconfigureMock, setHiddenMissionTypesMock, pushMock]) {
      m.mockReset();
    }
    pathname = "/projects/instance-1/agents/%40opengroow%2Fvideo-demo";
    serveProjectManifests(["video-demo", "hello", "engagement", "seo", "visual-social"].map(manifestOf));
    agents();
    useActionMock.mockImplementation((action: string) => {
      if (action === "project_agents_node.refreshProjectAgent") return refreshMock;
      if (action === "project_agents_node.deactivateProjectAgent") return deactivateMock;
      if (action === "project_agents_node.reconfigureProjectAgent") return reconfigureMock;
      throw new Error(`Unexpected action: ${action}`);
    });
    useMutationMock.mockImplementation((mutation: string) => {
      if (mutation === "project_agents.setHiddenMissionTypes") return setHiddenMissionTypesMock;
      throw new Error(`Unexpected mutation: ${mutation}`);
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    document.body.innerHTML = "";
  });

  describe("Template availability", () => {
    it("404s when the Project does not offer the Template", async () => {
      serveProjectManifests([]);
      await expect(render(<AgentOverview instanceId="instance-1" templateId="@opengroow/video-demo" />)).rejects.toThrow(
        "NEXT_NOT_FOUND",
      );
    });
  });

  describe("layout", () => {
    it("shows the Agent's name and status with all four tabs linked when active", async () => {
      agents({ templateId: "@opengroow/video-demo", status: "active", workspaceKey: "ws-video" });
      await render(
        <AgentPageLayout instanceId="instance-1" templateId="@opengroow/video-demo">
          <p>content</p>
        </AgentPageLayout>,
      );
      expect(document.querySelector("h1")?.textContent).toContain(manifestOf("video-demo").name);
      expect(document.body.textContent).toContain("Active");
      expect(document.body.textContent).toContain("content");
      expect(tab("Overview")?.getAttribute("href")).toBe("/projects/instance-1/agents/%40opengroow%2Fvideo-demo");
      expect(tab("Settings")?.getAttribute("href")).toBe("/projects/instance-1/agents/%40opengroow%2Fvideo-demo/settings");
      expect(tab("Files")?.getAttribute("href")).toBe("/projects/instance-1/agents/%40opengroow%2Fvideo-demo/files");
      expect(tab("Logs")?.getAttribute("href")).toBe("/projects/instance-1/agents/%40opengroow%2Fvideo-demo/logs");
    });

    it("greys out Files and Logs for an inactive Agent but keeps Overview and Settings", async () => {
      await render(
        <AgentPageLayout instanceId="instance-1" templateId="@opengroow/video-demo">
          <p>content</p>
        </AgentPageLayout>,
      );
      expect(tab("Files")?.getAttribute("aria-disabled")).toBe("true");
      expect(tab("Files")?.getAttribute("href")).toBeNull();
      expect(tab("Logs")?.getAttribute("aria-disabled")).toBe("true");
      expect(tab("Overview")?.getAttribute("href")).toBe("/projects/instance-1/agents/%40opengroow%2Fvideo-demo");
      expect(tab("Settings")?.getAttribute("href")).toBe("/projects/instance-1/agents/%40opengroow%2Fvideo-demo/settings");
    });
  });

  describe("Header actions", () => {
    const layout = (templateId: string) => (
      <AgentPageLayout instanceId="instance-1" templateId={templateId}>
        <p>content</p>
      </AgentPageLayout>
    );

    it("lets an active Agent be refreshed, and deactivated from the more-actions menu", async () => {
      agents({ templateId: "@opengroow/hello", status: "active", workspaceKey: "ws-hello" });
      refreshMock.mockResolvedValue({ status: "refreshed" });
      deactivateMock.mockResolvedValue({ status: "ok" });
      await render(layout("@opengroow/hello"));

      await act(async () => button("Refresh")!.click());
      expect(refreshMock).toHaveBeenCalledWith({ instanceId: "instance-1", templateId: "@opengroow/hello" });
      expect(button("Deactivate")).toBeUndefined();
      await act(async () => (document.querySelector('[aria-label="More actions"]') as HTMLElement).click());
      const deactivate = Array.from(document.querySelectorAll('[role="menuitem"]')).find((el) =>
        el.textContent?.includes("Deactivate"),
      ) as HTMLElement;
      await act(async () => deactivate.click());
      expect(deactivateMock).toHaveBeenCalledWith({ instanceId: "instance-1", templateId: "@opengroow/hello" });
      expect(pushMock).toHaveBeenCalledWith("/projects/instance-1/agents");
    });

    it("shows the stored error of a failed Agent, without Refresh or the menu", async () => {
      agents({ templateId: "@opengroow/hello", status: "error", errorMessage: "MCP unreachable" });
      await render(
        <AgentPageLayout instanceId="instance-1" templateId="@opengroow/hello">
          <AgentOverview instanceId="instance-1" templateId="@opengroow/hello" />
        </AgentPageLayout>,
      );
      expect(document.body.textContent).toContain("MCP unreachable");
      expect(button("Refresh")).toBeUndefined();
      expect(document.querySelector('[aria-label="More actions"]')).toBeNull();
    });
  });

  describe("Overview missions", () => {
    it("shows the Agent's Mission counts and its recent Missions with their status", async () => {
      overview = {
        recent: [
          { _id: "m1", type: "lym_create_letter_video", status: "done", updatedAt: Date.now() - 2 * 3_600_000 },
          { _id: "m2", type: "unknown_type", status: "failed", updatedAt: Date.now() - 3 * 86_400_000 },
        ],
        counts: { doing: 3, toValidate: 5, failed: 42 },
        truncated: false,
      };
      agents({ templateId: "@opengroow/video-demo", status: "active", workspaceKey: "ws-video" });
      await render(<AgentOverview instanceId="instance-1" templateId="@opengroow/video-demo" />);

      const text = document.body.textContent ?? "";
      expect(text).toContain("42");
      expect(text).toContain("In progress");
      expect(text).toContain("To validate");
      expect(text).toContain("Create letter video");
      expect(text).toContain("Unknown Type");
      expect(text).toContain("2 hours ago");
      expect(text).toContain("3 days ago");
      expect(text).toContain("Done");
      expect(text).toContain("Failed");
      expect(document.querySelector('a[href="/projects/instance-1/missions/m1"]')).not.toBeNull();
      expect(document.querySelector('a[href="/projects/instance-1/missions"]')).not.toBeNull();
    });

    it("marks the counts as N+ when only the latest Missions were counted", async () => {
      overview = { ...NO_MISSIONS, counts: { doing: 2, toValidate: 1, failed: 180 }, truncated: true };
      agents({ templateId: "@opengroow/video-demo", status: "active", workspaceKey: "ws-video" });
      await render(<AgentOverview instanceId="instance-1" templateId="@opengroow/video-demo" />);
      expect(document.body.textContent).toContain("180+");
    });

    it("says so when the Agent has no Missions", async () => {
      agents({ templateId: "@opengroow/video-demo", status: "active", workspaceKey: "ws-video" });
      await render(<AgentOverview instanceId="instance-1" templateId="@opengroow/video-demo" />);
      expect(document.body.textContent).toContain("No Missions yet for this Agent.");
    });
  });

  describe("Header refresh", () => {
    it("shows a spinner while refreshing and the refresh error afterwards", async () => {
      agents({ templateId: "@opengroow/hello", status: "active", workspaceKey: "ws-hello" });
      let resolve!: (v: { status: "error"; errorMessage: string }) => void;
      refreshMock.mockReturnValue(new Promise((r) => (resolve = r)));
      await render(
        <AgentPageLayout instanceId="instance-1" templateId="@opengroow/hello">
          <p>content</p>
        </AgentPageLayout>,
      );

      await act(async () => button("Refresh")!.click());
      expect(button("Refreshing…")!.disabled).toBe(true);

      await act(async () => resolve({ status: "error", errorMessage: "Workspace write failed" }));
      expect(button("Refresh")!.disabled).toBe(false);
      expect(document.body.textContent).toContain("Workspace write failed");
    });
  });

  describe("Settings", () => {
    it("offers Edit config only when the Template has editable fields", async () => {
      agents({ templateId: "@opengroow/engagement", status: "active", workspaceKey: "ws-se" });
      await render(<AgentSettings instanceId="instance-1" templateId="@opengroow/engagement" />);
      expect(button("Edit config")).toBeDefined();

      agents({ templateId: "@opengroow/seo", status: "active", workspaceKey: "ws-seo" });
      await render(<AgentSettings instanceId="instance-1" templateId="@opengroow/seo" />);
      expect(button("Edit config")).toBeUndefined();
    });

    describe("MCP server URL override (#654)", () => {
      const serveOverrides = (overrides: Array<{ serverName: string; url: string }>) =>
        useQueryMock.mockImplementation((query: string) =>
          query === "template_mcp_overrides.listForTemplate"
            ? overrides
            : [{ templateId: "@opengroow/seo", status: "active", workspaceKey: "ws-seo", mcpServerKeys: [] }],
        );

      it("is absent unless the deployment is self-hosted", async () => {
        serveOverrides([]);
        await render(<AgentSettings instanceId="instance-1" templateId="@opengroow/seo" />);
        expect(document.body.textContent).not.toContain("MCP server configuration");
      });

      it("shows the URL the Template declares as the placeholder while no override is saved", async () => {
        useMutationMock.mockImplementation(() => vi.fn());
        serveOverrides([]);
        await render(<AgentSettings instanceId="instance-1" templateId="@opengroow/seo" selfHost />);
        const input = document.querySelector("#mcp-url-article-mcp") as HTMLInputElement;
        expect(input.value).toBe("");
        expect(input.placeholder).toBe(manifestFixture("seo").mcpServers[0]!.url);
      });

      it("lists each MCP server with its override and saves a new URL", async () => {
        const setMock = vi.fn().mockResolvedValue(undefined);
        useMutationMock.mockImplementation((mutation: string) =>
          mutation === "template_mcp_overrides.set" ? setMock : vi.fn(),
        );
        serveOverrides([{ serverName: "article-mcp", url: "http://localhost:4000/mcp" }]);
        await render(<AgentSettings instanceId="instance-1" templateId="@opengroow/seo" selfHost />);
        const input = document.querySelector("#mcp-url-article-mcp") as HTMLInputElement;
        expect(input.value).toBe("http://localhost:4000/mcp");

        const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
        await act(async () => {
          setValue.call(input, "https://my-seo.internal/mcp");
          input.dispatchEvent(new Event("input", { bubbles: true }));
        });
        const panel = input.closest('[data-slot="settings-panel"]')!;
        const save = Array.from(panel.querySelectorAll("button")).find((b) => b.textContent?.includes("Save changes"));
        await act(async () => save!.click());
        expect(setMock).toHaveBeenCalledWith({
          projectId: "instance-1",
          templateId: "@opengroow/seo",
          serverName: "article-mcp",
          url: "https://my-seo.internal/mcp",
        });
        // Convex pushes the new URL to the running Agent itself: no refresh.
        expect(refreshMock).not.toHaveBeenCalled();
      });
    });

    it("opens an edit config dialog pre-filled with the stored config and reconfigures on save", async () => {
      reconfigureMock.mockResolvedValue({ status: "updated" });
      agents({
        templateId: "@opengroow/engagement",
        status: "active",
        workspaceKey: "ws-social",
        config: {
          accountHandleInstagram: "@brand",
          accountHandleTiktok: "@brand.tt",
          accountBio: "Old bio",
          likeWhen: "street photography",
          classifierApiKey: "agent-key",
        },
      });
      await render(<AgentSettings instanceId="instance-1" templateId="@opengroow/engagement" />);
      await act(async () => button("Edit config")!.click());

      const dialog = document.querySelector('[role="dialog"]') as HTMLElement;
      const bio = Array.from(dialog.querySelectorAll("label"))
        .find((l) => l.textContent?.trim() === "Account description")
        ?.htmlFor;
      const field = document.getElementById(bio!) as HTMLTextAreaElement;
      expect(field.value).toBe("Old bio");
      await act(async () => {
        const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
        setter.call(field, "New bio");
        field.dispatchEvent(new Event("input", { bubbles: true }));
      });
      await act(async () => {
        Array.from(dialog.querySelectorAll("button")).find((b) => b.textContent?.includes("Save"))!.click();
      });

      expect(reconfigureMock).toHaveBeenCalledWith({
        instanceId: "instance-1",
        templateId: "@opengroow/engagement",
        userConfig: expect.objectContaining({ accountBio: "New bio", likeWhen: "street photography" }),
      });
      await act(async () => {});
      expect(document.querySelector('[role="dialog"]')).toBeNull();
    });

    it("lists Available Mission types inverted against the deny-list, stores the unchecked ones, then refreshes", async () => {
      agents({
        templateId: "@opengroow/video-demo",
        status: "active",
        workspaceKey: "ws-video",
        hiddenMissionTypes: ["create_chat_mock_video"],
      });
      setHiddenMissionTypesMock.mockResolvedValue(undefined);
      refreshMock.mockResolvedValue({ status: "refreshed" });
      await render(<AgentSettings instanceId="instance-1" templateId="@opengroow/video-demo" />);

      const checkbox = (label: string) =>
        Array.from(document.querySelectorAll("label"))
          .find((l) => l.textContent?.includes(label))
          ?.querySelector('[role="checkbox"]') as HTMLElement;
      const isChecked = (el: HTMLElement) => el.getAttribute("aria-checked") === "true";
      expect(document.body.textContent).toContain("Available Mission types");
      expect(isChecked(checkbox("Create letter video"))).toBe(true);
      expect(isChecked(checkbox("Create chat mock video"))).toBe(false);

      await act(async () => checkbox("Create letter video").click());
      await act(async () => button("Save changes")!.click());
      expect(setHiddenMissionTypesMock).toHaveBeenCalledWith({
        instanceId: "instance-1",
        templateId: "@opengroow/video-demo",
        hiddenMissionTypes: ["lym_create_letter_video", "create_chat_mock_video"],
      });
      expect(refreshMock).toHaveBeenCalledWith({ instanceId: "instance-1", templateId: "@opengroow/video-demo" });
    });

    it("explains that there is nothing to configure when an active Agent has no editable requirement and a single Mission type", async () => {
      agents({ templateId: "@opengroow/visual-social", status: "active", workspaceKey: "ws-visual-social" });
      await render(<AgentSettings instanceId="instance-1" templateId="@opengroow/visual-social" />);
      expect(document.body.textContent).toContain("Nothing to configure for this Agent");
      expect(button("Edit config")).toBeUndefined();

      agents({ templateId: "@opengroow/video-demo", status: "active", workspaceKey: "ws-video" });
      await render(<AgentSettings instanceId="instance-1" templateId="@opengroow/video-demo" />);
      expect(document.body.textContent).not.toContain("Nothing to configure for this Agent");
    });

    it("hides Mission types when the Agent is inactive or has a single type", async () => {
      await render(<AgentSettings instanceId="instance-1" templateId="@opengroow/video-demo" />);
      expect(document.body.textContent).not.toContain("Available Mission types");

      agents({ templateId: "@opengroow/hello", status: "active", workspaceKey: "ws-hello" });
      await render(<AgentSettings instanceId="instance-1" templateId="@opengroow/hello" />);
      expect(document.body.textContent).not.toContain("Available Mission types");
    });
  });
});
