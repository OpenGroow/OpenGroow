/** @vitest-environment jsdom */

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { manifestFixture, serveProjectManifests, useQueryWithTemplates } from "./fixtures/manifests";
import type { AgentManifest } from "@convex/template_manifest_contract";
import { InstanceWorkspaceDetailPage } from "../src/components/instance-workspace-detail-page";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const addSkillMock = vi.fn();
const listWorkspacesMock = vi.fn();
const readWorkspaceFileMock = vi.fn();
const listSkillFilesMock = vi.fn();
const useQueryMock = vi.fn();
const useActionMock = vi.fn();
const useAuthenticatedInstancesMock = vi.fn();

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={typeof href === "string" ? href : "#"} {...props}>
      {children}
    </a>
  ),
}));

let currentSearchParams = new URLSearchParams();
const routerPushMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerPushMock }),
  useSearchParams: () => currentSearchParams,
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
    project_agents: {
      listByInstance: "project_agents.listByInstance",
    },
    project_agents_node: {
      addAgentSkill: "project_agents_node.addAgentSkill",
    },
    workspace_operations_node: {
      readWorkspaceFile: "workspace_operations_node.readWorkspaceFile",
      listWorkspaces: "workspace_operations_node.listWorkspaces",
      listSkillFiles: "workspace_operations_node.listSkillFiles",
    },
  },
}));

vi.mock("@/src/hooks/use-authenticated-instances", () => ({
  useAuthenticatedInstances: () => useAuthenticatedInstancesMock(),
}));

function getRequiredButton(text: string): HTMLButtonElement {
  return getRequiredButtonWithin(document.body, text);
}

function getRequiredButtonWithin(root: ParentNode, text: string): HTMLButtonElement {
  const buttons = Array.from(root.querySelectorAll("button"));
  const button = buttons.find((candidate) => candidate.textContent?.includes(text));
  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`Button not found: ${text}`);
  }
  return button;
}

function getRequiredDialog(): HTMLElement {
  const dialog = document.querySelector('[role="dialog"]');
  if (!(dialog instanceof HTMLElement)) {
    throw new Error("Dialog not found");
  }
  return dialog;
}

function getRequiredInput(labelText: string): HTMLInputElement {
  const labels = Array.from(document.querySelectorAll("label"));
  const label = labels.find((candidate) => candidate.textContent?.trim() === labelText);
  if (!(label instanceof HTMLLabelElement)) {
    throw new Error(`Label not found: ${labelText}`);
  }

  const controlId = label.htmlFor;
  const control = controlId ? document.getElementById(controlId) : null;
  if (control instanceof HTMLInputElement) {
    return control;
  }

  const nestedControl = label.querySelector("input");
  if (nestedControl instanceof HTMLInputElement) {
    return nestedControl;
  }

  throw new Error(`Control not found for label: ${labelText}`);
}

async function click(element: HTMLElement) {
  await act(async () => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

async function typeInto(control: HTMLInputElement, value: string) {
  await act(async () => {
    control.focus();
    const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
    descriptor?.set?.call(control, value);
    control.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

const workspaceFixture = {
  workspaceKey: "ws-hello",
  label: "Hello",
  absolutePath: "/workspace/hello",
  isActive: true,
  kind: "default" as const,
  availableFiles: [],
};

describe("InstanceWorkspaceDetailPage", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    currentSearchParams = new URLSearchParams();
    routerPushMock.mockReset();
    addSkillMock.mockReset();
    listWorkspacesMock.mockReset();
    readWorkspaceFileMock.mockReset();
    listSkillFilesMock.mockReset();
    useQueryMock.mockReset();
    useActionMock.mockReset();
    useAuthenticatedInstancesMock.mockReset();

    // Never resolve — the page shows the Convex-cached `workspaceList` below
    // while the runtime dispatch stays pending. A resolved-but-empty response
    // would flip the command into an "error" state and hide the cache.
    listWorkspacesMock.mockReturnValue(new Promise(() => {}));
    readWorkspaceFileMock.mockReturnValue(new Promise(() => {}));
    listSkillFilesMock.mockReturnValue(new Promise(() => {}));

    useQueryMock.mockReturnValue([]);
    useAuthenticatedInstancesMock.mockReturnValue([
      {
        _id: "instance-record-1",
        jobId: "job-1",
        status: "ready",
        openclawId: "instance-1",
        workspaceList: { workspaces: [workspaceFixture] },
      },
    ]);
    useActionMock.mockImplementation((action: string) => {
      if (action === "project_agents_node.addAgentSkill") return addSkillMock;
      if (action === "workspace_operations_node.listWorkspaces") return listWorkspacesMock;
      if (action === "workspace_operations_node.listSkillFiles") return listSkillFilesMock;
      if (action === "workspace_operations_node.readWorkspaceFile") return readWorkspaceFileMock;
      throw new Error(`Unexpected action: ${action}`);
    });

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

  async function renderPage(manifests: AgentManifest[]) {
    serveProjectManifests(manifests);
    const params = Promise.resolve({ instanceId: "instance-1", workspaceKey: "ws-hello" });
    await act(async () => {
      root.render(<InstanceWorkspaceDetailPage params={params} />);
    });
  }

  it("shows Add Skill only when the workspace's Agent is active", async () => {
    const helloManifest = manifestFixture("hello");
    if (!helloManifest) throw new Error("Hello template not found");

    useQueryMock.mockReturnValue([
      { templateId: "@opengroow/hello", status: "active", workspaceKey: "ws-hello", mcpServerKeys: [] },
    ]);
    await renderPage([helloManifest]);
    expect(getRequiredButton("Add Skill")).toBeTruthy();

    await act(async () => {
      root.unmount();
    });
    container.remove();
    document.body.innerHTML = "";
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    useQueryMock.mockReturnValue([]);
    await renderPage([helloManifest]);
    const buttons = Array.from(document.querySelectorAll("button")).map((b) => b.textContent);
    expect(buttons.some((text) => text?.includes("Add Skill"))).toBe(false);
  });

  describe("embedded in an Agent page (agentTemplateId)", () => {
    async function renderEmbedded() {
      useAuthenticatedInstancesMock.mockReturnValue([
        {
          _id: "instance-record-1",
          jobId: "job-1",
          status: "ready",
          openclawId: "instance-1",
          workspaceList: {
            workspaces: [
              {
                ...workspaceFixture,
                availableFiles: [{ filePath: "AGENTS.md", title: "AGENTS", kind: "standard" }],
              },
            ],
          },
        },
      ]);
      const helloManifest = manifestFixture("hello");
      if (!helloManifest) throw new Error("Hello template not found");
      const params = Promise.resolve({ instanceId: "instance-1", workspaceKey: "ws-hello" });
      await act(async () => {
        root.render(
          <InstanceWorkspaceDetailPage params={params} agentTemplateId="@opengroow/hello" />,
        );
      });
    }

    it("keeps file selection inside the Agent's Files tab", async () => {
      await renderEmbedded();
      const link = Array.from(document.querySelectorAll("a")).find((a) => a.textContent === "AGENTS.md");
      expect(link?.getAttribute("href")).toBe("/projects/instance-1/agents/%40opengroow%2Fhello/files?file=AGENTS.md");
    });

    it("drops the back-to-Workspaces button", async () => {
      await renderEmbedded();
      expect(Array.from(document.querySelectorAll("button")).some((b) => b.textContent?.includes("Back to Workspaces"))).toBe(
        false,
      );
    });
  });

  it("opens the Add Skill dialog and calls addAgentSkill with the matched Agent's templateId", async () => {
    const helloManifest = manifestFixture("hello");
    if (!helloManifest) throw new Error("Hello template not found");
    addSkillMock.mockImplementation((args) => {
      if (args.instanceId) {
        return Promise.resolve({
          status: "installed",
          skill: { source: "clawhub", spec: args.spec, origin: "user", status: "installed", updatedAt: 1 },
        });
      }
      return Promise.resolve({ status: "error", errorMessage: "unexpected" });
    });
    useQueryMock.mockReturnValue([
      { templateId: "@opengroow/hello", status: "active", workspaceKey: "ws-hello", mcpServerKeys: [] },
    ]);

    await renderPage([helloManifest]);
    await click(getRequiredButton("Add Skill"));

    const dialog = getRequiredDialog();
    expect(dialog.textContent).toContain("change this Agent's behavior");

    await typeInto(getRequiredInput("ClawHub skill"), "  my-clawhub-skill  ");
    await click(getRequiredButtonWithin(dialog, "Add Skill"));

    expect(addSkillMock).toHaveBeenCalledWith({
      instanceId: "instance-1",
      templateId: "@opengroow/hello",
      spec: "my-clawhub-skill",
    });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it("shows an already-required message without keeping the dialog open", async () => {
    const helloManifest = manifestFixture("hello");
    if (!helloManifest) throw new Error("Hello template not found");
    addSkillMock.mockResolvedValue({
      status: "already_required",
      skill: { source: "clawhub", spec: "avoid-ai-writing", origin: "template", status: "installed", updatedAt: 1 },
    });
    useQueryMock.mockReturnValue([
      { templateId: "@opengroow/hello", status: "active", workspaceKey: "ws-hello", mcpServerKeys: [] },
    ]);

    await renderPage([helloManifest]);
    await click(getRequiredButton("Add Skill"));
    await typeInto(getRequiredInput("ClawHub skill"), "avoid-ai-writing");
    await click(getRequiredButtonWithin(getRequiredDialog(), "Add Skill"));

    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.body.textContent).toContain("already required and installed");
  });

  it("renders the compact skills list for the matched Agent, distinguishing required from user-added skills", async () => {
    const helloManifest = manifestFixture("hello");
    if (!helloManifest) throw new Error("Hello template not found");
    useQueryMock.mockReturnValue([
      {
        templateId: "@opengroow/hello",
        status: "active",
        workspaceKey: "ws-hello",
        mcpServerKeys: [],
        skills: [
          { source: "clawhub", spec: "avoid-ai-writing", origin: "template", status: "installed", updatedAt: 1 },
          { source: "clawhub", spec: "broken-skill", origin: "user", status: "error", updatedAt: 2, errorMessage: "network error" },
        ],
      },
    ]);

    await renderPage([helloManifest]);

    expect(document.body.textContent).toContain("avoid-ai-writing");
    expect(document.body.textContent).toContain("Required");
    expect(document.body.textContent).toContain("broken-skill");
    expect(document.body.textContent).toContain("Added by you");
    expect(document.body.textContent).toContain("network error");
  });

  it("lists a skill's files on demand when the skill is clicked", async () => {
    const helloManifest = manifestFixture("hello");
    if (!helloManifest) throw new Error("Hello template not found");
    useQueryMock.mockReturnValue([
      {
        templateId: "@opengroow/hello",
        status: "active",
        workspaceKey: "ws-hello",
        mcpServerKeys: [],
        skills: [
          { source: "clawhub", spec: "avoid-ai-writing", origin: "template", status: "installed", updatedAt: 1 },
        ],
      },
    ]);
    listSkillFilesMock.mockResolvedValue({
      workspaceKey: "ws-hello",
      spec: "avoid-ai-writing",
      files: [
        {
          filePath: "skills/avoid-ai-writing/SKILL.md",
          title: "SKILL",
          kind: "skill",
        },
      ],
    });

    await renderPage([helloManifest]);

    await click(getRequiredButton("avoid-ai-writing"));

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(listSkillFilesMock).toHaveBeenCalledWith({
      instanceId: "instance-1",
      workspaceKey: "ws-hello",
      spec: "avoid-ai-writing",
    });
    expect(document.body.textContent).toContain("skills/avoid-ai-writing/SKILL.md");
  });

  it("dispatches a file read for a skill file selected via the URL once its skill listing loads", async () => {
    // Regression test: clicking a skill file used to do nothing, because
    // `resolveSelectedFilePath` only recognised paths from
    // `workspace.availableFiles`, which never includes on-demand skill files.
    const helloManifest = manifestFixture("hello");
    if (!helloManifest) throw new Error("Hello template not found");
    currentSearchParams = new URLSearchParams("file=skills/avoid-ai-writing/SKILL.md");
    useQueryMock.mockReturnValue([
      {
        templateId: "@opengroow/hello",
        status: "active",
        workspaceKey: "ws-hello",
        mcpServerKeys: [],
        skills: [
          { source: "clawhub", spec: "avoid-ai-writing", origin: "template", status: "installed", updatedAt: 1 },
        ],
      },
    ]);
    listSkillFilesMock.mockResolvedValue({
      workspaceKey: "ws-hello",
      spec: "avoid-ai-writing",
      files: [
        {
          filePath: "skills/avoid-ai-writing/SKILL.md",
          title: "SKILL",
          kind: "skill",
        },
      ],
    });
    readWorkspaceFileMock.mockReturnValue(new Promise(() => {}));

    await renderPage([helloManifest]);
    await click(getRequiredButton("avoid-ai-writing"));

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(readWorkspaceFileMock).toHaveBeenCalledWith({
      instanceId: "instance-1",
      workspaceKey: "ws-hello",
      filePath: "skills/avoid-ai-writing/SKILL.md",
    });
  });

  it("renders content and business errors returned by the typed file operation", async () => {
    useAuthenticatedInstancesMock.mockReturnValue([
      {
        _id: "instance-record-1",
        jobId: "job-1",
        status: "ready",
        openclawId: "instance-1",
        workspaceList: {
          workspaces: [
            {
              ...workspaceFixture,
              availableFiles: [{ filePath: "AGENTS.md", title: "AGENTS", kind: "standard" }],
            },
          ],
        },
      },
    ]);
    readWorkspaceFileMock.mockResolvedValue({
      found: true,
      workspaceKey: "ws-hello",
      filePath: "AGENTS.md",
      title: "AGENTS",
      content: "# Typed workspace content",
    });

    await renderPage([]);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(document.body.textContent).toContain("Typed workspace content");

    await act(async () => {
      root.unmount();
    });
    container.remove();
    document.body.innerHTML = "";
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    readWorkspaceFileMock.mockResolvedValue({
      found: false,
      error: "Workspace file not found",
    });
    await renderPage([]);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(document.body.textContent).toContain("Workspace file not found");
  });
});
