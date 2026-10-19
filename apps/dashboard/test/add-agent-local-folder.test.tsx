/** @vitest-environment jsdom */

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { manifestFixture } from "./fixtures/manifests";
import { AddAgentDialog } from "../src/components/add-agent-dialog";
import { Input } from "@/components/ui/input";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Add Agent from a local folder (#707): offered on self-hosted deployments only. */

const previewMock = vi.fn();
const installMock = vi.fn();
const hubCatalogueMock = vi.fn();

vi.mock("convex/react", () => ({
  useQuery: () => [],
  useAction: (action: string) => {
    if (action === "project_templates_node.hubCatalogue") return hubCatalogueMock;
    if (action === "project_templates_node.previewLocalFolder") return previewMock;
    if (action === "project_templates_node.installLocalFolder") return installMock;
    return vi.fn();
  },
}));

vi.mock("@convex/_generated/api", () => ({
  api: {
    project_templates: { catalogue: "project_templates.catalogue" },
    project_templates_node: {
      hubCatalogue: "project_templates_node.hubCatalogue",
      previewHubTemplate: "project_templates_node.previewHubTemplate",
      installHubTemplate: "project_templates_node.installHubTemplate",
      previewLocalFolder: "project_templates_node.previewLocalFolder",
      installLocalFolder: "project_templates_node.installLocalFolder",
    },
  },
}));

const manifest = { ...manifestFixture("seo"), id: "@acme/seo", name: "Acme SEO" };
const PLAN = { mcpHosts: ["seo.acme.dev"], secrets: [], skills: [], prerequisites: [] };

/** A file as `<Input webkitdirectory>` reports it. */
function pickedFile(path: string, content: string | Uint8Array) {
  const bytes = typeof content === "string" ? new TextEncoder().encode(content) : content;
  return { webkitRelativePath: path, size: bytes.byteLength, arrayBuffer: async () => bytes.slice().buffer as ArrayBuffer };
}

describe("Add Agent from a local folder (#707)", () => {
  let container: HTMLDivElement;
  let root: Root;
  const onAdd = vi.fn();

  beforeEach(() => {
    for (const mock of [previewMock, installMock, hubCatalogueMock, onAdd]) mock.mockReset();
    hubCatalogueMock.mockResolvedValue({ entries: [] });
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

  async function renderDialog(selfHost: boolean) {
    await act(async () => {
      root.render(
        <AddAgentDialog projectId="p-1" instanceId="instance-1" selfHost={selfHost} open onOpenChange={() => {}} onAdd={onAdd} />,
      );
    });
  }

  async function pickFolder(files: ReturnType<typeof pickedFile>[]) {
    const input = document.querySelector<HTMLInputElement>('input[type="file"]');
    if (!input) throw new Error("No folder input");
    Object.defineProperty(input, "files", { value: files, configurable: true });
    await act(async () => {
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
  }

  const buttonLabels = () => Array.from(document.querySelectorAll("button")).map((b) => b.textContent?.trim());

  const GOOD_FOLDER = [pickedFile("acme-seo/package.json", "{}"), pickedFile("acme-seo/CLAW.md", "# c")];

  it("offers the option on a self-hosted deployment", async () => {
    await renderDialog(true);
    expect(buttonLabels()).toContain("Add from a local folder");
  });

  it("does not offer the option on the hosted deployment", async () => {
    await renderDialog(false);
    expect(buttonLabels()).not.toContain("Add from a local folder");
    expect(document.querySelector('input[type="file"]')).toBeNull();
  });

  it("sends the picked folder's files to the preview and shows the installation plan, installing nothing", async () => {
    previewMock.mockResolvedValue({ status: "ok", manifest, plan: PLAN });
    await renderDialog(true);
    await pickFolder([...GOOD_FOLDER, pickedFile("acme-seo/.git/HEAD", "ref")]);

    expect(previewMock).toHaveBeenCalledWith({
      instanceId: "instance-1",
      files: [
        { path: "CLAW.md", content: "# c" },
        { path: "package.json", content: "{}" },
      ],
    });
    expect(document.body.textContent).toContain("seo.acme.dev");
    expect(installMock).not.toHaveBeenCalled();
  });

  it("installs the folder then activates the Agent on confirmation", async () => {
    previewMock.mockResolvedValue({ status: "ok", manifest, plan: PLAN });
    installMock.mockResolvedValue({ status: "installed", templateId: "@acme/seo", version: "1.0.0" });
    onAdd.mockResolvedValue(undefined);
    await renderDialog(true);
    await pickFolder(GOOD_FOLDER);

    const apiKey = document.querySelector<HTMLInputElement>("input[type=password], input[type=text]");
    if (apiKey) {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      await act(async () => {
        setter.call(apiKey, "key-1");
        apiKey.dispatchEvent(new Event("input", { bubbles: true }));
      });
    }
    const confirm = Array.from(document.querySelectorAll("button")).find((b) => b.textContent?.includes("Install and activate"))!;
    await act(async () => {
      confirm.click();
    });

    expect(installMock).toHaveBeenCalledWith({
      instanceId: "instance-1",
      files: [
        { path: "CLAW.md", content: "# c" },
        { path: "package.json", content: "{}" },
      ],
    });
    expect(onAdd).toHaveBeenCalledWith("@acme/seo", expect.any(Object));
  });

  it("shows the validation error of the server and installs nothing", async () => {
    previewMock.mockResolvedValue({ status: "error", errorMessage: "CLAW.md: missing agent.id" });
    await renderDialog(true);
    await pickFolder(GOOD_FOLDER);

    expect(document.body.textContent).toContain("CLAW.md: missing agent.id");
    expect(installMock).not.toHaveBeenCalled();
  });

  it("refuses a folder without CLAW.md or with a binary file before calling the server", async () => {
    await renderDialog(true);
    await pickFolder([pickedFile("acme-seo/package.json", "{}")]);
    expect(document.body.textContent).toContain("CLAW.md");

    await pickFolder([...GOOD_FOLDER, pickedFile("acme-seo/logo.png", new Uint8Array([0x89, 0xff, 0xfe]))]);
    expect(document.body.textContent).toContain("logo.png");
    expect(previewMock).not.toHaveBeenCalled();
  });
});
