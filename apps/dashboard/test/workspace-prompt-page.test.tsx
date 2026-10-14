/** @vitest-environment jsdom */

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { serveProjectManifests, useQueryWithTemplates } from "./fixtures/manifests";
import { WorkspacePromptPage } from "../src/components/workspace-prompt-page";
import type { AgentManifest } from "@convex/template_manifest_contract";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const useQueryMock = vi.fn();
const useActionMock = vi.fn();
const getWorkspaceRunTranscriptMock = vi.fn();
const useAuthenticatedInstancesMock = vi.fn();
const searchParamsGetMock = vi.fn((key: string) => (key === "runId" ? "run-1" : key === "missionId" ? "mission-1" : null));

vi.mock("next/navigation", () => ({
  useSearchParams: () => ({ get: searchParamsGetMock }),
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
    runs: { get: "runs.get", listByMission: "runs.listByMission" },
    missions: { get: "missions.get" },
    workspace_logs_node: { getWorkspaceRunTranscript: "workspace_logs_node.getWorkspaceRunTranscript" },
  },
}));

vi.mock("@/src/hooks/use-authenticated-instances", () => ({
  useAuthenticatedInstances: () => useAuthenticatedInstancesMock(),
}));

vi.mock("@/src/components/workspace-markdown", () => ({
  WorkspaceMarkdown: ({ content }: { content: string }) => <div data-testid="markdown">{content}</div>,
}));

const RUN_1 = {
  _id: "run-1",
  missionId: "mission-1",
  templateId: "@opengroow/openmontage-agent",
  agentsMdSnapshot: "# Agent instructions\nDo the thing.",
  contextMdSnapshot: "# Brand Core\nWarm and intimate.\n\n# Mission mission-1\n...",
};

const MISSION_1 = {
  _id: "mission-1",
  type: "create_reel",
};

const MANIFEST_WITH_GENERATIVE_CALL: AgentManifest = {
  id: "@opengroow/openmontage-agent",
  name: "Openmontage Agent",
  description: "test",
  category: "marketing",
  mcpServers: [],
  missionTypes: [{ type: "create_reel", label: "Create reel", payload: "{}", agentsMd: "create_reel.md" }],
  generativeMcpCall: { create_reel: { toolName: "generate_assets" } },
} as unknown as AgentManifest;

describe("WorkspacePromptPage", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    useQueryMock.mockReset();
    useActionMock.mockReset();
    getWorkspaceRunTranscriptMock.mockReset();
    useAuthenticatedInstancesMock.mockReset();
    searchParamsGetMock.mockReset();
    searchParamsGetMock.mockImplementation((key: string) => (key === "runId" ? "run-1" : key === "missionId" ? "mission-1" : null));

    useAuthenticatedInstancesMock.mockReturnValue([
      { _id: "instance-record-1", jobId: "job-1", status: "ready", openclawId: "instance-1" },
    ]);
    useActionMock.mockImplementation((action: string) => {
      if (action === "workspace_logs_node.getWorkspaceRunTranscript") return getWorkspaceRunTranscriptMock;
      throw new Error(`Unexpected action: ${action}`);
    });
    getWorkspaceRunTranscriptMock.mockResolvedValue({ found: true, turns: [] });

    useQueryMock.mockImplementation((query: string, args: unknown) => {
      if (query === "runs.get") return args === "skip" ? undefined : RUN_1;
      if (query === "missions.get") return args === "skip" ? undefined : MISSION_1;
      if (query === "runs.listByMission") return args === "skip" ? undefined : [RUN_1];
      return undefined;
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

  async function render(manifests: AgentManifest[] = []) {
    serveProjectManifests(manifests);
    const params = Promise.resolve({ projectId: "instance-1", workspaceKey: "ws-hello" });
    await act(async () => {
      root.render(<WorkspacePromptPage params={params} />);
    });
  }

  it("explains what Instructions and Génération each mean and how they relate", async () => {
    await render([MANIFEST_WITH_GENERATIVE_CALL]);
    const text = document.body.textContent ?? "";
    expect(text).toMatch(/agent/i);
    expect(text).toMatch(/decides|writes|produces/i);
    expect(text).toMatch(/generate_assets|MCP/i);
  });

  it("shows the Instructions panel with the Run's agentsMdSnapshot and contextMdSnapshot", async () => {
    await render();
    expect(document.body.textContent).toContain("Do the thing.");
    expect(document.body.textContent).toContain("Warm and intimate.");
  });

  it("requests the session transcript for the matched runtime instance, workspace key and Run", async () => {
    await render([MANIFEST_WITH_GENERATIVE_CALL]);
    expect(getWorkspaceRunTranscriptMock).toHaveBeenCalledWith({
      instanceId: "instance-1",
      workspaceKey: "ws-hello",
      runId: "run-1",
    });
  });

  it("fetches the transcript of the Run that actually resolved the generative job, not the currently-viewed Run (each Run has its own session)", async () => {
    const sourceRun = {
      ...RUN_1,
      _id: "run-0-source",
      intermediateResult: { jobType: "generate_assets", output: {} },
    };
    const currentRun = { ...RUN_1, intermediateResult: undefined };
    useQueryMock.mockImplementation((query: string, args: unknown) => {
      if (query === "runs.get") return args === "skip" ? undefined : currentRun;
      if (query === "missions.get") return args === "skip" ? undefined : MISSION_1;
      if (query === "runs.listByMission") return args === "skip" ? undefined : [sourceRun, currentRun];
      return undefined;
    });
    await render([MANIFEST_WITH_GENERATIVE_CALL]);
    expect(getWorkspaceRunTranscriptMock).toHaveBeenCalledWith({
      instanceId: "instance-1",
      workspaceKey: "ws-hello",
      runId: "run-0-source",
    });
  });

  it("matches a tool_call recorded with the MCP server prefix (e.g. 'media-mcp.generate_assets'), not just the bare tool name", async () => {
    getWorkspaceRunTranscriptMock.mockResolvedValue({
      found: true,
      turns: [
        {
          kind: "tool_call",
          toolName: "media-mcp.generate_assets",
          arguments: { plan: { shots: [{ scene_id: "sc1", type: "video", prompt: "prefixed tool call prompt" }] } },
        },
      ],
    });
    await render([MANIFEST_WITH_GENERATIVE_CALL]);
    expect(document.body.textContent).toContain("prefixed tool call prompt");
  });

  it("shows the Génération panel with the exact arguments of the matching tool_call found in the transcript", async () => {
    getWorkspaceRunTranscriptMock.mockResolvedValue({
      found: true,
      turns: [
        { kind: "message", role: "assistant", text: "Working on it" },
        {
          kind: "tool_call",
          toolName: "generate_assets",
          arguments: { shots: [{ scene_id: "sc1", type: "video", prompt: "the exact sent prompt" }] },
        },
      ],
    });
    await render([MANIFEST_WITH_GENERATIVE_CALL]);
    expect(document.body.textContent).toContain("Génération");
    expect(document.body.textContent).toContain("the exact sent prompt");
    // Must not include job-output-only fields (path, cost_usd) — this is the
    // literal call, not the job's result.
    expect(document.body.textContent).not.toContain("cost_usd");
  });

  it("renders the Génération panel's JSON as a markdown fenced code block, styled like Instructions", async () => {
    getWorkspaceRunTranscriptMock.mockResolvedValue({
      found: true,
      turns: [{ kind: "tool_call", toolName: "generate_assets", arguments: { shots: [] } }],
    });
    await render([MANIFEST_WITH_GENERATIVE_CALL]);
    const markdownBlocks = document.querySelectorAll('[data-testid="markdown"]');
    const generationBlock = Array.from(markdownBlocks).find((el) => el.textContent?.includes("shots"));
    expect(generationBlock).toBeDefined();
    expect(generationBlock!.textContent).toContain("```json");
  });

  it("shows a not-found message when no matching tool_call exists in the transcript", async () => {
    getWorkspaceRunTranscriptMock.mockResolvedValue({ found: true, turns: [] });
    await render([MANIFEST_WITH_GENERATIVE_CALL]);
    expect(document.body.textContent).toContain("No");
    expect(document.body.textContent).toContain("generate_assets");
    expect(document.body.textContent).toContain("found");
  });

  it("hides the Génération panel when the Template does not declare generativeMcpCall", async () => {
    await render([{ ...MANIFEST_WITH_GENERATIVE_CALL, generativeMcpCall: undefined }]);
    expect(document.body.textContent).not.toContain("Génération");
  });
});
