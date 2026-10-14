/** @vitest-environment jsdom */

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { manifestFixture, serveCatalogue, serveProjectManifests, useQueryWithTemplates } from "./fixtures/manifests";
import type { AgentManifest } from "@convex/template_manifest_contract";
import { ActivationDialog } from "../src/components/activation-dialog";
import { InstanceAgentsContent } from "../src/components/instance-agents-page";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const activateMock = vi.fn();
const addAgentMock = vi.fn();
const deactivateMock = vi.fn();
const refreshMock = vi.fn();
const setHiddenMissionTypesMock = vi.fn();
const updateConfigMock = vi.fn();
const retryStatusCheckMock = vi.fn();
const useQueryMock = vi.fn();
const useActionMock = vi.fn();
const useMutationMock = vi.fn();
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
  useMutation: (...args: unknown[]) => useMutationMock(...args),
}));

vi.mock("@convex/_generated/api", () => ({
  api: {
    project_templates: {
      listForProject: "project_templates.listForProject",
      getForProject: "project_templates.getForProject",
      catalogue: "project_templates.catalogue",
      updates: "project_templates.updates",
      applyUpdate: "project_templates.applyUpdate",
    },
    project_agents: {
      listByInstance: "project_agents.listByInstance",
      setHiddenMissionTypes: "project_agents.setHiddenMissionTypes",
    },
    project_templates_node: {
      hubCatalogue: "project_templates_node.hubCatalogue",
      previewHubTemplate: "project_templates_node.previewHubTemplate",
      installHubTemplate: "project_templates_node.installHubTemplate",
      previewLocalFolder: "project_templates_node.previewLocalFolder",
      installLocalFolder: "project_templates_node.installLocalFolder",
    },
    project_agents_node: {
      activateProjectAgent: "project_agents_node.activateProjectAgent",
      addProjectAgent: "project_agents_node.addProjectAgent",
      deactivateProjectAgent: "project_agents_node.deactivateProjectAgent",
      refreshProjectAgent: "project_agents_node.refreshProjectAgent",
      reconfigureProjectAgent: "project_agents_node.reconfigureProjectAgent",
      retryProjectAgentStatusCheck: "project_agents_node.retryProjectAgentStatusCheck",
    },
  },
}));

vi.mock("@/src/hooks/use-authenticated-instances", () => ({
  useAuthenticatedInstances: () => useAuthenticatedInstancesMock(),
}));

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
};

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

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

function getRequiredInput(labelText: string): HTMLInputElement | HTMLTextAreaElement {
  const labels = Array.from(document.querySelectorAll("label"));
  const label = labels.find((candidate) => candidate.textContent?.trim() === labelText);
  if (!(label instanceof HTMLLabelElement)) {
    throw new Error(`Label not found: ${labelText}`);
  }

  const controlId = label.htmlFor;
  const control = controlId ? document.getElementById(controlId) : null;
  if (control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement) {
    return control;
  }

  const nestedControl = label.querySelector("input,textarea");
  if (nestedControl instanceof HTMLInputElement || nestedControl instanceof HTMLTextAreaElement) {
    return nestedControl;
  }

  throw new Error(`Control not found for label: ${labelText}`);
}

function getRequiredSelect(labelText: string): HTMLSelectElement {
  const labels = Array.from(document.querySelectorAll("label"));
  const label = labels.find((candidate) => candidate.textContent?.trim() === labelText);
  if (!(label instanceof HTMLLabelElement)) {
    throw new Error(`Label not found: ${labelText}`);
  }

  const controlId = label.htmlFor;
  const control = controlId ? document.getElementById(controlId) : null;
  if (control instanceof HTMLSelectElement) {
    return control;
  }

  const nestedControl = label.querySelector("select");
  if (nestedControl instanceof HTMLSelectElement) {
    return nestedControl;
  }

  throw new Error(`Select not found for label: ${labelText}`);
}

function getRequiredCheckbox(labelText: string): HTMLInputElement {
  const label = Array.from(document.querySelectorAll("label")).find((candidate) =>
    candidate.textContent?.includes(labelText),
  );
  const checkbox = label?.querySelector('input[type="checkbox"]');
  if (!(checkbox instanceof HTMLInputElement)) {
    throw new Error(`Checkbox not found: ${labelText}`);
  }
  return checkbox;
}

async function click(element: HTMLElement) {
  await act(async () => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

async function typeInto(control: HTMLInputElement | HTMLTextAreaElement, value: string) {
  await act(async () => {
    control.focus();
    const prototype = control instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");
    descriptor?.set?.call(control, value);
    control.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function selectValue(control: HTMLSelectElement, value: string) {
  await act(async () => {
    control.focus();
    const descriptor = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value");
    descriptor?.set?.call(control, value);
    control.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

describe("ActivationDialog", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
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

  it("renders a mix of required/optional leaf field types and keeps submit disabled until required fields are filled", async () => {
    const manifest: AgentManifest = {
      id: "test-mixed-fields",
      name: "Test Agent",
      description: "Mixed field types",
      category: "test",
      mcpServers: [],
      requirements: [
        { key: "apiKey", type: "password", label: "API key", required: true, placeholder: "sk-...", immutable: true },
        { key: "domain", type: "text", label: "Domain", required: true },
        { key: "language", type: "text", label: "Language", required: true },
        { key: "country", type: "text", label: "Country", required: true },
        { key: "context", type: "textarea", label: "Context", required: false },
      ],
    };

    await act(async () => {
      root.render(
        <ActivationDialog
          manifest={manifest}
          open
          onOpenChange={() => {}}
          onSubmit={vi.fn()}
        />,
      );
    });

    expect(getRequiredDialog()).toBeTruthy();
    expect(getRequiredInput("API key")).toBeInstanceOf(HTMLInputElement);
    expect((getRequiredInput("API key") as HTMLInputElement).type).toBe("password");
    expect((getRequiredInput("API key") as HTMLInputElement).placeholder).toBe("sk-...");
    expect((getRequiredInput("API key") as HTMLInputElement).required).toBe(true);
    expect(getRequiredInput("API key").getAttribute("aria-required")).toBe("true");
    expect(getRequiredInput("Domain")).toBeInstanceOf(HTMLInputElement);
    expect((getRequiredInput("Domain") as HTMLInputElement).required).toBe(true);
    expect(getRequiredInput("Language")).toBeInstanceOf(HTMLInputElement);
    expect(getRequiredInput("Country")).toBeInstanceOf(HTMLInputElement);
    expect(getRequiredInput("Context")).toBeInstanceOf(HTMLTextAreaElement);
    expect((getRequiredInput("Context") as HTMLTextAreaElement).required).toBe(false);

    const submitButton = getRequiredButtonWithin(getRequiredDialog(), "Activate");
    expect(submitButton.disabled).toBe(true);

    await typeInto(getRequiredInput("API key"), "api-key-123");
    await typeInto(getRequiredInput("Domain"), "example.com");
    await typeInto(getRequiredInput("Language"), "en");
    expect(submitButton.disabled).toBe(true);

    await typeInto(getRequiredInput("Country"), "US");
    expect(submitButton.disabled).toBe(false);
  });

  it("renders a group requirement as a fieldset with legend and wired leaf fields", async () => {
    const manifest: AgentManifest = {
      id: "test-group",
      name: "Test Agent",
      description: "Group test",
      category: "test",
      mcpServers: [],
      requirements: [
        {
          type: "group",
          label: "GitHub Publisher",
          fields: [
            { key: "githubOwner", type: "text", label: "Owner", required: true },
            { key: "githubToken", type: "password", label: "Token", required: true },
          ],
        },
      ],
    };

    await act(async () => {
      root.render(
        <ActivationDialog manifest={manifest} open onOpenChange={() => {}} onSubmit={vi.fn()} />,
      );
    });

    const fieldset = document.querySelector("fieldset");
    expect(fieldset).not.toBeNull();
    const legend = fieldset?.querySelector("legend");
    expect(legend?.textContent).toContain("GitHub Publisher");

    expect(getRequiredInput("Owner")).toBeInstanceOf(HTMLInputElement);
    expect(getRequiredInput("Token")).toBeInstanceOf(HTMLInputElement);
    expect((getRequiredInput("Token") as HTMLInputElement).type).toBe("password");

    const submitButton = getRequiredButtonWithin(getRequiredDialog(), "Activate");
    expect(submitButton.disabled).toBe(true);

    await typeInto(getRequiredInput("Owner"), "my-org");
    expect(submitButton.disabled).toBe(true);

    await typeInto(getRequiredInput("Token"), "ghp_secret");
    expect(submitButton.disabled).toBe(false);
  });

  it("renders select requirements as a dropdown with default value and submits the selected value", async () => {
    const manifest: AgentManifest = {
      id: "test-select",
      name: "Test Agent",
      description: "Select test",
      category: "test",
      mcpServers: [],
      requirements: [
        {
          key: "defaultFormat",
          type: "select",
          label: "Default format",
          required: false,
          defaultValue: "hook-plus-letter",
          options: [
            { value: "hook-plus-letter", label: "Hook + letter" },
            { value: "letter-only", label: "Letter only" },
          ],
        },
      ],
    };
    const onSubmit = vi.fn();

    await act(async () => {
      root.render(
        <ActivationDialog manifest={manifest} open onOpenChange={() => {}} onSubmit={onSubmit} />,
      );
    });

    const select = getRequiredSelect("Default format");
    expect(select.value).toBe("hook-plus-letter");
    expect(Array.from(select.options).map((option) => [option.value, option.textContent])).toEqual([
      ["hook-plus-letter", "Hook + letter"],
      ["letter-only", "Letter only"],
    ]);

    await selectValue(select, "letter-only");
    await click(getRequiredButtonWithin(getRequiredDialog(), "Activate"));

    expect(onSubmit).toHaveBeenCalledWith({ defaultFormat: "letter-only" });
  });

  it("resolves a {key} token in a field's label against the current value of the sibling field it references (issue #345)", async () => {
    const manifest: AgentManifest = {
      id: "test-dynamic-label",
      name: "Test Agent",
      description: "Dynamic label test",
      category: "test",
      mcpServers: [],
      requirements: [
        {
          key: "platform",
          type: "select",
          label: "Platform",
          required: true,
          options: [
            { value: "instagram", label: "Instagram" },
            { value: "tiktok", label: "TikTok" },
          ],
        },
        {
          key: "accountHandle",
          type: "text",
          label: "Account handle ({platform})",
          required: true,
        },
      ],
    };
    const onSubmit = vi.fn();

    await act(async () => {
      root.render(
        <ActivationDialog manifest={manifest} open onOpenChange={() => {}} onSubmit={onSubmit} />,
      );
    });

    // No platform selected yet: the "(...)" group is dropped, not left empty.
    expect(getRequiredInput("Account handle")).toBeTruthy();

    const platformSelect = getRequiredSelect("Platform");
    await selectValue(platformSelect, "instagram");
    expect(getRequiredInput("Account handle (Instagram)")).toBeTruthy();

    await selectValue(platformSelect, "tiktok");
    expect(getRequiredInput("Account handle (TikTok)")).toBeTruthy();
  });

  it("cancels without submitting", async () => {
    const manifest = manifestFixture("seo");
    if (!manifest) throw new Error("SEO template not found");
    const onSubmit = vi.fn();
    const onOpenChange = vi.fn();

    await act(async () => {
      root.render(
        <ActivationDialog manifest={manifest} open onOpenChange={onOpenChange} onSubmit={onSubmit} />,
      );
    });

    await click(getRequiredButtonWithin(getRequiredDialog(), "Cancel"));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});

describe("InstanceAgentsContent", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    activateMock.mockReset();
    addAgentMock.mockReset();
    serveCatalogue([]);
    deactivateMock.mockReset();
    refreshMock.mockReset();
    setHiddenMissionTypesMock.mockReset();
    useMutationMock.mockReset();
    updateConfigMock.mockReset();
    retryStatusCheckMock.mockReset();
    useQueryMock.mockReset();
    useActionMock.mockReset();
    useAuthenticatedInstancesMock.mockReset();

    useQueryMock.mockReturnValue([]);
    useAuthenticatedInstancesMock.mockReturnValue([
      {
        _id: "instance-record-1",
        jobId: "job-1",
        status: "ready",
        openclawId: "instance-1",
      },
    ]);
    useMutationMock.mockImplementation((mutation: string) => {
      if (mutation === "project_agents.setHiddenMissionTypes") return setHiddenMissionTypesMock;
      if (mutation === "project_templates.applyUpdate") return vi.fn();
      throw new Error(`Unexpected mutation: ${mutation}`);
    });
    useActionMock.mockImplementation((action: string) => {
      if (action === "project_agents_node.activateProjectAgent") return activateMock;
      if (action === "project_agents_node.addProjectAgent") return addAgentMock;
      if (action === "project_agents_node.deactivateProjectAgent") return deactivateMock;
      if (action === "project_agents_node.refreshProjectAgent") return refreshMock;
      if (action === "project_agents_node.reconfigureProjectAgent") return updateConfigMock;
      if (action === "project_agents_node.retryProjectAgentStatusCheck") return retryStatusCheckMock;
      if (action.startsWith("project_templates_node.")) return vi.fn();
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
    await act(async () => {
      root.render(<InstanceAgentsContent instanceId="instance-1" />);
    });
  }

  it("reactivates an inactive Hello Agent directly without opening the dialog", async () => {
    const helloManifest = manifestFixture("hello");
    if (!helloManifest) throw new Error("Hello template not found");
    activateMock.mockResolvedValue({ status: "ok" });
    useQueryMock.mockReturnValue([{ templateId: "@opengroow/hello", status: "inactive", mcpServerKeys: [] }]);

    await renderPage([helloManifest]);
    await click(getRequiredButton("Activate"));

    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(activateMock).toHaveBeenCalledWith({
      instanceId: "instance-1",
      templateId: "@opengroow/hello",
    });
  });

  it("shows only Open on an active Agent's card, linking to its page", async () => {
    const helloManifest = manifestFixture("hello");
    if (!helloManifest) throw new Error("Hello template not found");
    useQueryMock.mockReturnValue([
      { templateId: "@opengroow/hello", status: "active", workspaceKey: "ws-hello", mcpServerKeys: [] },
    ]);

    await renderPage([helloManifest]);

    const open = Array.from(document.querySelectorAll("a")).find((a) => a.textContent?.includes("Open"));
    expect(open?.getAttribute("href")).toBe("/projects/instance-1/agents/%40opengroow%2Fhello");
    // The card itself carries no button; the only one is the page-level Add Agent.
    expect(Array.from(document.querySelectorAll("button")).map((b) => b.textContent?.trim())).toEqual(["Add Agent"]);
    for (const label of ["Refresh", "Deactivate", "Edit config", "Open workspace"]) {
      expect(document.body.textContent).not.toContain(label);
    }
    expect(document.body.textContent).not.toContain("Hide Mission types");
    expect(document.body.textContent).not.toContain("Available Mission types");
  });

  it("does not list the Template's MCP servers on the card", async () => {
    const seo = manifestFixture("seo");
    if (!seo) throw new Error("SEO template not found");
    expect(seo.mcpServers.length).toBeGreaterThan(0);
    useQueryMock.mockReturnValue([{ templateId: "@opengroow/seo", status: "inactive", mcpServerKeys: [] }]);

    await renderPage([seo]);

    for (const server of seo.mcpServers) {
      expect(document.body.textContent).not.toContain(server.name);
    }
  });

  it("shows neither the category nor a status badge on the card", async () => {
    const helloManifest = manifestFixture("hello");
    if (!helloManifest) throw new Error("Hello template not found");
    useQueryMock.mockReturnValue([
      { templateId: "@opengroow/hello", status: "active", workspaceKey: "ws-hello", mcpServerKeys: [] },
    ]);

    await renderPage([{ ...helloManifest, category: "zzz-category" } as AgentManifest]);

    expect(document.body.textContent).not.toContain("zzz-category");
    expect(document.body.textContent).not.toMatch(/\bActive\b/);
  });

  it("prefills the Activate dialog with the Agent's stored config when reactivating", async () => {
    const seoManifest = manifestFixture("seo");
    if (!seoManifest) throw new Error("SEO template not found");
    // Deactivating an Agent never clears its stored `config` (only its
    // `status`) — reactivating it should show what's already there instead
    // of an empty form.
    useQueryMock.mockReturnValue([
      {
        templateId: "@opengroow/seo",
        status: "inactive",
        mcpServerKeys: [],
        config: { apiKey: "stored-key" },
      },
    ]);

    await renderPage([seoManifest]);
    await click(getRequiredButton("Activate"));

    expect((getRequiredInput("API key") as HTMLInputElement).value).toBe("stored-key");
  });

  it("closes after a successful activation request resolves", async () => {
    const seoManifest = manifestFixture("seo");
    if (!seoManifest) throw new Error("SEO template not found");
    const deferred = createDeferred<{ status: string }>();
    activateMock.mockReturnValue(deferred.promise);
    useQueryMock.mockReturnValue([{ templateId: "@opengroow/seo", status: "inactive", mcpServerKeys: [] }]);

    await renderPage([seoManifest]);
    await click(getRequiredButton("Activate"));

    await typeInto(getRequiredInput("API key"), "api-key-123");
    await click(getRequiredButtonWithin(getRequiredDialog(), "Activate"));

    expect(activateMock).toHaveBeenCalledWith({
      instanceId: "instance-1",
      templateId: "@opengroow/seo",
      userConfig: { apiKey: "api-key-123" },
    });
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();

    deferred.resolve({ status: "ok" });
    await act(async () => {
      await deferred.promise;
    });

    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it("keeps the dialog open and preserves values when activation fails", async () => {
    const seoManifest = manifestFixture("seo");
    if (!seoManifest) throw new Error("SEO template not found");
    const deferred = createDeferred<never>();
    activateMock.mockReturnValue(deferred.promise);
    useQueryMock.mockReturnValue([{ templateId: "@opengroow/seo", status: "inactive", mcpServerKeys: [] }]);

    await renderPage([seoManifest]);
    await click(getRequiredButton("Activate"));

    await typeInto(getRequiredInput("API key"), "api-key-123");
    await click(getRequiredButtonWithin(getRequiredDialog(), "Activate"));

    deferred.reject(new Error("Activation failed"));
    await act(async () => {
      try {
        await deferred.promise;
      } catch {}
    });

    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    expect((getRequiredInput("API key") as HTMLInputElement).value).toBe("api-key-123");
  });

  // Config Completeness (issue #320, ADR-034).
  it("renders errorLink as a clickable link inside the error banner", async () => {
    const seoManifest = manifestFixture("seo");
    if (!seoManifest) throw new Error("SEO template not found");
    useQueryMock.mockReturnValue([
      {
        templateId: "@opengroow/seo",
        status: "error",
        mcpServerKeys: [],
        errorMessage: "The Project is not fully configured yet.",
        errorLink: "https://article-mcp.example/dashboard/proj-1",
        config: { apiKey: "key-old" },
      },
    ]);

    await renderPage([seoManifest]);

    expect(document.body.textContent).toContain("The Project is not fully configured yet.");
    const link = document.querySelector('a[href="https://article-mcp.example/dashboard/proj-1"]');
    expect(link).not.toBeNull();
  });

  it("Retry calls retryProjectAgentStatusCheck (not the activation dialog) when the Agent already has a stored apiKey", async () => {
    const seoManifest = manifestFixture("seo");
    if (!seoManifest) throw new Error("SEO template not found");
    retryStatusCheckMock.mockResolvedValue({ status: "active", workspaceKey: "ws-seo", mcpServerKeys: [] });
    useQueryMock.mockReturnValue([
      {
        templateId: "@opengroow/seo",
        status: "error",
        mcpServerKeys: [],
        errorMessage: "The Project is not fully configured yet.",
        errorLink: "https://article-mcp.example/dashboard/proj-1",
        config: { apiKey: "key-old" },
      },
    ]);

    await renderPage([seoManifest]);
    await click(getRequiredButton("Retry"));

    expect(retryStatusCheckMock).toHaveBeenCalledWith({ instanceId: "instance-1", templateId: "@opengroow/seo" });
    expect(activateMock).not.toHaveBeenCalled();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it("Retry reopens the activation dialog when the Agent has no stored apiKey (the key itself was rejected)", async () => {
    const seoManifest = manifestFixture("seo");
    if (!seoManifest) throw new Error("SEO template not found");
    useQueryMock.mockReturnValue([
      {
        templateId: "@opengroow/seo",
        status: "error",
        mcpServerKeys: [],
        errorMessage: "The API key was rejected by article-mcp.",
        config: undefined,
      },
    ]);

    await renderPage([seoManifest]);
    await click(getRequiredButton("Retry"));

    expect(retryStatusCheckMock).not.toHaveBeenCalled();
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  });
});

describe("Add Agent catalogue (#655)", () => {
  let container: HTMLDivElement;
  let root: Root;

  const seoEntry = {
    templateId: "@opengroow/seo",
    manifest: { ...manifestFixture("seo"), name: "SEO Agent", description: "Search engine optimisation" },
    version: "1.2.0",
    origin: "local_folder",
    added: false,
    plan: {
      mcpHosts: ["seo.example.com"],
      secrets: [{ key: "apiKey", label: "API key", required: true }],
      skills: ["@owner/seo-skill"],
      prerequisites: [{ name: "Android CLI", minVersion: "1.0", instructionsUrl: "https://example.com/android-cli" }],
    },
  };
  const helloEntry = {
    templateId: "@opengroow/hello",
    manifest: { ...manifestFixture("hello"), name: "Hello Agent", description: "Says hello" },
    version: "0.0.1",
    origin: "local_folder",
    added: false,
    plan: { mcpHosts: [], secrets: [], skills: [], prerequisites: [] },
  };

  beforeEach(() => {
    addAgentMock.mockReset();
    activateMock.mockReset();
    useQueryMock.mockReset();
    useActionMock.mockReset();
    useAuthenticatedInstancesMock.mockReset();
    useQueryMock.mockReturnValue([]);
    useAuthenticatedInstancesMock.mockReturnValue([
      { _id: "instance-record-1", jobId: "job-1", status: "ready", openclawId: "instance-1" },
    ]);
    useMutationMock.mockReturnValue(vi.fn());
    useActionMock.mockImplementation((action: string) => {
      if (action === "project_agents_node.addProjectAgent") return addAgentMock;
      if (action === "project_templates_node.hubCatalogue") return vi.fn().mockResolvedValue({ entries: [] });
      return vi.fn();
    });
    serveProjectManifests([manifestFixture("seo"), manifestFixture("hello")]);
    serveCatalogue([seoEntry, helloEntry]);
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

  async function renderPage() {
    await act(async () => {
      root.render(<InstanceAgentsContent instanceId="instance-1" />);
    });
  }

  it("does not list Templates the Project has no Agent of as cards", async () => {
    await renderPage();
    expect(document.body.textContent).not.toContain("SEO Agent");
    expect(document.body.textContent).toContain("Add Agent");
  });

  it("lists the catalogue with each Template's version and origin", async () => {
    await renderPage();
    await click(getRequiredButton("Add Agent"));

    const dialog = getRequiredDialog();
    expect(dialog.textContent).toContain("SEO Agent");
    expect(dialog.textContent).toContain("Local folder");
    expect(dialog.textContent).toContain("1.2.0");
    expect(dialog.textContent).toContain("Hello Agent");
  });

  it("does not offer a Template the Project already has an Agent of", async () => {
    serveCatalogue([{ ...seoEntry, added: true }, helloEntry]);
    await renderPage();
    await click(getRequiredButton("Add Agent"));

    expect(getRequiredDialog().textContent).not.toContain("SEO Agent");
    expect(getRequiredDialog().textContent).toContain("Hello Agent");
  });

  it("shows the installation plan before confirmation, and adds the Agent only once confirmed", async () => {
    addAgentMock.mockResolvedValue({ status: "active", workspaceKey: "ws", mcpServerKeys: [] });
    await renderPage();
    await click(getRequiredButton("Add Agent"));
    await click(getRequiredButtonWithin(getRequiredDialog(), "Choose SEO Agent"));

    const dialog = getRequiredDialog();
    expect(dialog.textContent).toContain("seo.example.com");
    expect(dialog.textContent).toContain("API key");
    expect(dialog.textContent).toContain("@owner/seo-skill");
    expect(dialog.textContent).toContain("Android CLI");
    expect(dialog.textContent).toContain("1.0");
    expect(dialog.querySelector('a[href="https://example.com/android-cli"]')).not.toBeNull();
    expect(addAgentMock).not.toHaveBeenCalled();

    await typeInto(getRequiredInput("API key"), "key-123");
    // A machine-side prerequisite is shown, never a gate (#662).
    await click(getRequiredButtonWithin(getRequiredDialog(), "Install and activate"));

    expect(addAgentMock).toHaveBeenCalledWith({
      instanceId: "instance-1",
      templateId: "@opengroow/seo",
      userConfig: { apiKey: "key-123" },
    });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it("keeps the dialog open and says why when adding fails", async () => {
    addAgentMock.mockResolvedValue({ status: "error", errorMessage: "This Project already has an Agent of Template hello" });
    await renderPage();
    await click(getRequiredButton("Add Agent"));
    await click(getRequiredButtonWithin(getRequiredDialog(), "Choose Hello Agent"));
    await click(getRequiredButtonWithin(getRequiredDialog(), "Install and activate"));

    expect(getRequiredDialog().textContent).toContain("This Project already has an Agent of Template hello");
  });
});

describe("Add Agent hub entries and trust badges (#668)", () => {
  let container: HTMLDivElement;
  let root: Root;

  const hubCatalogueMock = vi.fn();
  const previewHubMock = vi.fn();
  const installHubMock = vi.fn();

  const localEntry = {
    templateId: "hello",
    manifest: { ...manifestFixture("hello"), name: "Hello Agent", description: "Says hello" },
    version: "0.0.1",
    origin: "local_folder",
    added: false,
    plan: { mcpHosts: [], secrets: [], skills: [], prerequisites: [] },
  };
  const hubEntries = [
    { templateId: "@opengroow/video", name: "Video", description: "Makes videos", category: "marketing", tag: "v1.0.0", verification: "official" },
    { templateId: "@bob/shop", name: "Shop Helper", description: "Shopify tasks", category: "commerce", tag: "v0.3.0", verification: "verified" },
    { templateId: "@alice/seo", name: "Alice SEO", description: "SEO from Alice", category: "marketing", tag: "v2.0.0", verification: "community" },
  ];
  const seoManifest = { ...manifestFixture("seo"), id: "@alice/seo", name: "Alice SEO" };

  beforeEach(() => {
    for (const mock of [addAgentMock, hubCatalogueMock, previewHubMock, installHubMock]) mock.mockReset();
    useQueryMock.mockReset();
    useActionMock.mockReset();
    useAuthenticatedInstancesMock.mockReset();
    useQueryMock.mockReturnValue([]);
    useAuthenticatedInstancesMock.mockReturnValue([
      { _id: "instance-record-1", jobId: "job-1", status: "ready", openclawId: "instance-1" },
    ]);
    useMutationMock.mockReturnValue(vi.fn());
    useActionMock.mockImplementation((action: string) => {
      if (action === "project_agents_node.addProjectAgent") return addAgentMock;
      if (action === "project_templates_node.hubCatalogue") return hubCatalogueMock;
      if (action === "project_templates_node.previewHubTemplate") return previewHubMock;
      if (action === "project_templates_node.installHubTemplate") return installHubMock;
      return vi.fn();
    });
    hubCatalogueMock.mockResolvedValue({ entries: hubEntries });
    serveProjectManifests([manifestFixture("hello")]);
    serveCatalogue([localEntry]);
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

  async function openCatalogue() {
    await act(async () => {
      root.render(<InstanceAgentsContent instanceId="instance-1" />);
    });
    await click(getRequiredButton("Add Agent"));
  }

  it("lists hub entries with their official, verified or community badge", async () => {
    await openCatalogue();

    const items = Array.from(getRequiredDialog().querySelectorAll("li")).map((li) => li.textContent ?? "");
    expect(items.find((text) => text.includes("Video"))).toContain("Official");
    expect(items.find((text) => text.includes("Shop Helper"))).toContain("Verified");
    expect(items.find((text) => text.includes("Alice SEO"))).toContain("Community");
    expect(items.find((text) => text.includes("Hello Agent"))).not.toContain("Official");
  });

  it("still lists the Project's own Templates when the hub cannot be read, and says so", async () => {
    hubCatalogueMock.mockResolvedValue({ entries: [], error: "Failed to download the hub index: HTTP 404" });
    await openCatalogue();

    expect(getRequiredDialog().textContent).toContain("Hello Agent");
    expect(getRequiredDialog().textContent).toContain("HTTP 404");
  });

  it("tells an offline start how to add a Template when the hub is unreachable and the Project has none", async () => {
    hubCatalogueMock.mockResolvedValue({ entries: [], error: "Failed to download the hub index: HTTP 404" });
    serveCatalogue([]);
    await openCatalogue();

    const text = getRequiredDialog().textContent ?? "";
    expect(text).toContain("HTTP 404");
    expect(text).toContain("pnpm template:add");
    expect(text).not.toContain("already in this Project");
  });

  it("shows the plan of a hub entry, then installs it from the hub and activates it on confirmation", async () => {
    previewHubMock.mockResolvedValue({
      status: "ok",
      manifest: seoManifest,
      plan: { mcpHosts: ["seo.alice.dev"], secrets: [], skills: [], prerequisites: [] },
    });
    installHubMock.mockResolvedValue({ status: "installed", templateId: "@alice/seo", version: "2.0.0" });
    addAgentMock.mockResolvedValue({ status: "active", workspaceKey: "ws", mcpServerKeys: [] });
    await openCatalogue();
    await click(getRequiredButtonWithin(getRequiredDialog(), "Choose Alice SEO"));

    expect(previewHubMock).toHaveBeenCalledWith({ instanceId: "instance-1", templateId: "@alice/seo" });
    expect(getRequiredDialog().textContent).toContain("seo.alice.dev");
    expect(installHubMock).not.toHaveBeenCalled();

    await typeInto(getRequiredInput("API key"), "key-1");
    await click(getRequiredButtonWithin(getRequiredDialog(), "Install and activate"));

    expect(installHubMock).toHaveBeenCalledWith({ instanceId: "instance-1", templateId: "@alice/seo" });
    expect(addAgentMock).toHaveBeenCalledWith({
      instanceId: "instance-1",
      templateId: "@alice/seo",
      userConfig: expect.objectContaining({ apiKey: "key-1" }),
    });
  });

  it("does not activate when the hub install is refused, and shows why", async () => {
    previewHubMock.mockResolvedValue({ status: "ok", manifest: seoManifest, plan: { mcpHosts: [], secrets: [], skills: [], prerequisites: [] } });
    installHubMock.mockResolvedValue({ status: "error", errorMessage: "Digest mismatch for acme/seo@v2.0.0" });
    await openCatalogue();
    await click(getRequiredButtonWithin(getRequiredDialog(), "Choose Alice SEO"));
    await typeInto(getRequiredInput("API key"), "key-1");
    await click(getRequiredButtonWithin(getRequiredDialog(), "Install and activate"));

    expect(addAgentMock).not.toHaveBeenCalled();
    expect(getRequiredDialog().textContent).toContain("Digest mismatch");
  });

  it("shows the badge of a hub Template already installed in the Project, without listing it twice", async () => {
    serveCatalogue([
      localEntry,
      { ...localEntry, templateId: "@bob/shop", manifest: { ...manifestFixture("hello"), id: "@bob/shop", name: "Shop Helper" }, origin: "hub", version: "0.3.0" },
    ]);
    await openCatalogue();

    const shop = Array.from(getRequiredDialog().querySelectorAll("li")).filter((li) => li.textContent?.includes("Shop Helper"));
    expect(shop).toHaveLength(1);
    expect(shop[0]!.textContent).toContain("Verified");
  });
});
