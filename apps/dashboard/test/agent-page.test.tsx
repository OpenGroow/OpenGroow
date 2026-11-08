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
const deactivateMock = vi.fn();
const reconfigureMock = vi.fn();
const applyHiddenMissionTypesMock = vi.fn();
const deleteMock = vi.fn();
let pathname = "/projects/instance-1/agents/%40opengroow%2Fvideo-demo";

const pushMock = vi.fn();
const replaceMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, replace: replaceMock }),
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
// The Template installs and update offers the Version card reads (reassigned by a test).
let installs: Array<{ templateId: string; version: string; origin: string }> = [];
let offers: Array<Record<string, unknown>> = [];
const checkHubUpdatesMock = vi.fn();
vi.mock("convex/react", () => ({
  useQuery: (...args: unknown[]) =>
    args[0] === "project_templates.origins"
      ? installs
      : args[0] === "project_templates.updates"
        ? offers
        : useQueryWithTemplates(useQueryMock)(...args),
  useAction: (...args: unknown[]) => useActionMock(...args),
  useMutation: (...args: unknown[]) => useMutationMock(...args),
}));
vi.mock("@convex/_generated/api", () => ({
  api: {
    project_templates: {
      listForProject: "project_templates.listForProject",
      getForProject: "project_templates.getForProject",
      origins: "project_templates.origins",
      updates: "project_templates.updates",
      applyUpdate: "project_templates.applyUpdate",
    },
    project_templates_node: { checkHubUpdates: "project_templates_node.checkHubUpdates" },
    template_mcp_overrides: {
      listForTemplate: "template_mcp_overrides.listForTemplate",
      set: "template_mcp_overrides.set",
      clear: "template_mcp_overrides.clear",
    },
    missions: { overviewByTemplate: "missions.overviewByTemplate" },
    project_agents: {
      listByInstance: "project_agents.listByInstance",
    },
    project_agents_node: {
      deactivateProjectAgent: "project_agents_node.deactivateProjectAgent",
      deleteProjectAgent: "project_agents_node.deleteProjectAgent",
      applyHiddenMissionTypes: "project_agents_node.applyHiddenMissionTypes",
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
    installs = [];
    offers = [];
    checkHubUpdatesMock.mockReset();
    for (const m of [useQueryMock, useActionMock, useMutationMock, deactivateMock, deleteMock, reconfigureMock, applyHiddenMissionTypesMock, pushMock, replaceMock]) {
      m.mockReset();
    }
    notFoundMock.mockClear();
    pathname = "/projects/instance-1/agents/%40opengroow%2Fvideo-demo";
    serveProjectManifests(["video-demo", "hello", "engagement", "seo", "visual-social"].map(manifestOf));
    agents();
    useActionMock.mockImplementation((action: string) => {
      if (action === "project_agents_node.applyHiddenMissionTypes") return applyHiddenMissionTypesMock;
      if (action === "project_agents_node.deactivateProjectAgent") return deactivateMock;
      if (action === "project_agents_node.deleteProjectAgent") return deleteMock;
      if (action === "project_templates_node.checkHubUpdates") return checkHubUpdatesMock;
      if (action === "project_agents_node.reconfigureProjectAgent") return reconfigureMock;
      throw new Error(`Unexpected action: ${action}`);
    });
    useMutationMock.mockImplementation((mutation: string) => {
      if (mutation === "project_templates.applyUpdate") return vi.fn();
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

    it("has no actions in the header: no Refresh (changes sync on their own), no more-actions menu", async () => {
      agents({ templateId: "@opengroow/hello", status: "active", workspaceKey: "ws-hello" });
      await render(layout("@opengroow/hello"));

      expect(button("Refresh")).toBeUndefined();
      expect(button("Deactivate")).toBeUndefined();
      expect(document.querySelector('[aria-label="More actions"]')).toBeNull();
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

  describe("Settings", () => {
    describe("Version", () => {
      const settings = () => render(<AgentSettings instanceId="instance-1" templateId="@opengroow/hello" />);

      it("shows a hub Template's version and checks the hub only on Check for updates", async () => {
        agents({ templateId: "@opengroow/hello", status: "active", workspaceKey: "ws-hello" });
        installs = [{ templateId: "@opengroow/hello", version: "1.0.0", origin: "hub" }];
        checkHubUpdatesMock.mockResolvedValue({ offered: [] });
        await settings();
        expect(document.body.textContent).toContain("Current version1.0.0");
        expect(checkHubUpdatesMock).not.toHaveBeenCalled();

        await act(async () => button("Check for updates")!.click());
        expect(checkHubUpdatesMock).toHaveBeenCalledWith({ instanceId: "instance-1", templateId: "@opengroow/hello" });
        expect(document.body.textContent).toContain("Up to date");
      });

      it("offers a newer version for review, with its update plan", async () => {
        agents({ templateId: "@opengroow/hello", status: "active", workspaceKey: "ws-hello" });
        installs = [{ templateId: "@opengroow/hello", version: "1.0.0", origin: "hub" }];
        offers = [{
          templateId: "@opengroow/hello", currentVersion: "1.0.0", availableVersion: "1.1.0", origin: "hub",
          plan: {
            fromVersion: "1.0.0", toVersion: "1.1.0", mcpHosts: { added: [], removed: [], changed: [] }, newSecrets: [], newPlugins: [],
            newSkills: [], newRequiredFields: [], reactivationFields: [], removedMissionTypes: [], removedMissionTypesInUse: [], requiresAttention: false,
          },
        }];
        await settings();
        expect(document.body.textContent).toContain("1.1.0 available");
        expect(button("Check for updates")).toBeUndefined();

        await act(async () => button("Review update")!.click());
        expect(document.body.textContent).toContain("Update @opengroow/hello to 1.1.0");
        expect(button("Apply update")).toBeDefined();
      });

      it("shows the origin of a Template not from the hub, without checking it", async () => {
        agents({ templateId: "@opengroow/hello", status: "active", workspaceKey: "ws-hello" });
        installs = [{ templateId: "@opengroow/hello", version: "0.3.0", origin: "linked_folder" }];
        await settings();
        expect(document.body.textContent).toContain("Local");
        expect(document.body.textContent).not.toContain("Linked");
        expect(button("Check for updates")).toBeUndefined();
      });
    });

    it("deactivates an active Agent from the danger zone once confirmed, and goes back to the list", async () => {
      agents({ templateId: "@opengroow/hello", status: "active", workspaceKey: "ws-hello" });
      deactivateMock.mockResolvedValue({ status: "inactive" });
      await render(<AgentSettings instanceId="instance-1" templateId="@opengroow/hello" />);

      await act(async () => button("Deactivate")!.click());
      expect(deactivateMock).not.toHaveBeenCalled();
      expect(document.body.textContent).toContain("Its configuration and its Missions are kept");
      const confirm = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')).find((b) => b.textContent === "Deactivate");
      await act(async () => confirm!.click());
      expect(deactivateMock).toHaveBeenCalledWith({ instanceId: "instance-1", templateId: "@opengroow/hello" });
      expect(pushMock).toHaveBeenCalledWith("/projects/instance-1/agents");
    });

    it("goes to the Agents list, not a 404, when the Agent's Template disappears while its page is open", async () => {
      agents({ templateId: "@opengroow/hello", status: "inactive" });
      await render(<AgentSettings instanceId="instance-1" templateId="@opengroow/hello" />);
      expect(document.body.textContent).toContain("Danger zone");

      serveProjectManifests(["video-demo", "engagement", "seo", "visual-social"].map(manifestOf));
      await render(<AgentSettings instanceId="instance-1" templateId="@opengroow/hello" />);

      expect(replaceMock).toHaveBeenCalledWith("/projects/instance-1/agents");
      expect(notFoundMock).not.toHaveBeenCalled();
    });

    it("deletes the Agent only once confirmed, and keeps the dialog open with the error when refused", async () => {
      agents({ templateId: "@opengroow/hello", status: "inactive" });
      deleteMock.mockResolvedValueOnce({ status: "error", errorMessage: "Cannot delete the Agent while one of its Runs is in flight" });
      await render(<AgentSettings instanceId="instance-1" templateId="@opengroow/hello" />);

      expect(button("Deactivate")).toBeUndefined();
      await act(async () => button("Delete")!.click());
      expect(deleteMock).not.toHaveBeenCalled();
      expect(document.body.textContent).toContain("This cannot be undone");

      await act(async () => button("Delete Hello")!.click());
      expect(deleteMock).toHaveBeenCalledWith({ instanceId: "instance-1", templateId: "@opengroow/hello" });
      expect(pushMock).not.toHaveBeenCalled();
      expect(document.querySelector('[role="alert"]')?.textContent).toContain("in flight");

      deleteMock.mockResolvedValueOnce({ status: "deleted" });
      await act(async () => button("Delete Hello")!.click());
      expect(pushMock).toHaveBeenCalledWith("/projects/instance-1/agents");
    });

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
        // Convex pushes the new URL to the running Agent itself: no workspace sync from the page.
        expect(applyHiddenMissionTypesMock).not.toHaveBeenCalled();
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

    it("lists Available Mission types inverted against the deny-list and applies the unchecked ones", async () => {
      agents({
        templateId: "@opengroow/video-demo",
        status: "active",
        workspaceKey: "ws-video",
        hiddenMissionTypes: ["create_chat_mock_video"],
      });
      applyHiddenMissionTypesMock.mockResolvedValue({ status: "refreshed" });
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
      expect(applyHiddenMissionTypesMock).toHaveBeenCalledWith({
        instanceId: "instance-1",
        templateId: "@opengroow/video-demo",
        hiddenMissionTypes: ["lym_create_letter_video", "create_chat_mock_video"],
      });
    });

    it("shows a Mission types failure at the top, not in the Delete confirmation", async () => {
      agents({ templateId: "@opengroow/video-demo", status: "active", workspaceKey: "ws-video" });
      applyHiddenMissionTypesMock.mockResolvedValue({ status: "error", errorMessage: "Workspace sync failed" });
      await render(<AgentSettings instanceId="instance-1" templateId="@opengroow/video-demo" />);

      const checkbox = Array.from(document.querySelectorAll("label"))
        .find((l) => l.textContent?.includes("Create letter video"))
        ?.querySelector('[role="checkbox"]') as HTMLElement;
      await act(async () => checkbox.click());
      await act(async () => button("Save changes")!.click());
      expect(document.body.textContent).toContain("Workspace sync failed");

      await act(async () => button("Delete")!.click());
      const dialog = document.querySelector('[role="dialog"]')!;
      expect(dialog.textContent).toContain("This cannot be undone");
      expect(dialog.textContent).not.toContain("Workspace sync failed");
    });

    it("shows no configuration and no explanation when an active Agent has nothing to configure", async () => {
      agents({ templateId: "@opengroow/visual-social", status: "active", workspaceKey: "ws-visual-social" });
      await render(<AgentSettings instanceId="instance-1" templateId="@opengroow/visual-social" />);
      expect(document.body.textContent).not.toContain("Nothing to configure");
      expect(button("Edit config")).toBeUndefined();
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
