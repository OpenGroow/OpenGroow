/** @vitest-environment jsdom */

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deriveSourcePipelineState, SourceDetailContent } from "../src/components/source-detail-page";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const useQueryMock = vi.fn();
const retryMock = vi.fn();
const forceProductionMock = vi.fn();

vi.mock("convex/react", () => ({
  useQuery: (...args: unknown[]) => useQueryMock(...args),
  useMutation: (ref: string) => (ref === "source_routing.forceProduction" ? forceProductionMock : retryMock),
}));

vi.mock("@convex/_generated/api", () => ({
  api: {
    sources: { get: "sources.get", retry: "sources.retry" },
  source_routing: { forceProduction: "source_routing.forceProduction" },
  },
}));

function makeSource(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    _id: "src-1",
    instanceId: "instance-1",
    templateId: "@opengroow/seo",
    sourceId: "keyword",
    label: "Search keyword",
    family: "search",
    status: "ready",
    origin: "https://example.com/serp",
    capturedAt: Date.UTC(2026, 0, 15),
    marketing: { summary: "running shoes trend", topics: ["running", "shoes"] },
    analysis: {},
    ...overrides,
  };
}

describe("SourceDetailContent", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    useQueryMock.mockReset();
    retryMock.mockReset();
    forceProductionMock.mockReset();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  async function render(result: unknown) {
    useQueryMock.mockReturnValue(result);
    await act(async () => {
      root.render(<SourceDetailContent instanceId="instance-1" sourceId="src-1" />);
    });
  }

  const text = () => document.body.textContent ?? "";

  it("shows loading and not-found states", async () => {
    await render(undefined);
    expect(text()).toContain("Loading");
    await render(null);
    expect(text()).toContain("Source not found");
  });

  it("renders what this teaches from the marketing layer, topics as chips", async () => {
    await render({ source: makeSource(), analysisSchema: null });
    expect(text()).toContain("What this teaches");
    expect(text()).toContain("running shoes trend");
    const chips = Array.from(document.querySelectorAll("[data-chip]")).map((c) => c.textContent);
    expect(chips).toEqual(["running", "shoes"]);
  });

  it("renders scoring only when OpenGroow computed some", async () => {
    await render({ source: makeSource(), analysisSchema: null });
    expect(text()).not.toContain("Scoring");
    await render({ source: makeSource({ scoring: { engagementScore: 0.82 } }), analysisSchema: null });
    expect(text()).toContain("Scoring details");
    expect(text()).toContain("Engagement score");
    expect(text()).toContain("0.82");
    expect(document.querySelector("[data-testid='scoring-details']")?.hasAttribute("open")).toBe(false);
  });

  it.each([
    ["processing", {}, "Ingestion"],
    ["ready", {}, "Ready"],
    ["ready", { scoring: { productFit: 0.75 } }, "Scored"],
    ["ready", { scoring: { productFit: 0.75 }, selectedAt: 1 }, "Routed"],
    ["ready", { scoring: { productFit: 0.75 }, selectedAt: 1, productionMissionId: "mission-1" }, "In production"],
    [
      "ready",
      { scoring: { productFit: 0.75 }, selectedAt: 1, productionMissionId: "mission-1", producedAt: 2 },
      "Produced",
    ],
    [
      "ready",
      { scoring: { productFit: 0.75 }, selectedAt: 1, productionMissionId: "mission-1", producedAt: 2, publishedAt: 3 },
      "Published",
    ],
  ] as const)("derives and renders the %s pipeline stage", async (status, fields, stage) => {
    await render({ source: makeSource({ status, ...fields }), analysisSchema: null });
    expect(deriveSourcePipelineState({ status, ...fields })).toEqual({ kind: "stage", current: stage });
    expect(document.querySelector(`[data-stage="${stage}"]`)?.getAttribute("aria-current")).toBe("step");
  });

  it.each([
    ["failed", {}, "Failed"],
    ["unavailable", {}, "Unavailable"],
    ["ready", { excluded: true }, "Excluded"],
  ] as const)("renders %s as a terminal pipeline state", async (status, fields, label) => {
    await render({ source: makeSource({ status, ...fields }), analysisSchema: null });
    expect(deriveSourcePipelineState({ status, ...fields })).toEqual({ kind: "terminal", label });
    expect(document.querySelector("[data-testid='source-pipeline-terminal']")?.textContent).toContain(label);
    expect(document.querySelector("[data-stage='Published']")).toBeNull();
  });

  it("keeps all six numeric scores collapsed below the pipeline", async () => {
    await render({
      source: makeSource({
        scoring: {
          productFit: 0.75,
          replicability: 0.5,
          creativeStrength: 0.25,
          rawEngagementScore: 12,
          engagementScore: 0.8,
          replicationScore: 0.7,
        },
      }),
      analysisSchema: null,
    });
    const details = document.querySelector("[data-testid='scoring-details']") as HTMLDetailsElement;
    expect(details.open).toBe(false);
    for (const label of ["Product fit", "Replicability", "Creative strength", "Raw engagement score", "Engagement score", "Replication score"]) {
      expect(details.textContent).toContain(label);
    }
  });

  it("shows a collapsed Raw section only when the Source carries a raw capture", async () => {
    await render({ source: makeSource(), analysisSchema: null });
    expect(text()).not.toContain("Raw");
    expect(document.querySelector("details")).toBeNull();

    await render({ source: makeSource({ raw: '{"html":"<b>hi</b>"}' }), analysisSchema: null });
    const details = document.querySelector("details");
    expect(details).not.toBeNull();
    expect(details?.open).toBe(false);
    expect(details?.querySelector("summary")?.textContent).toContain("Raw");
    expect(details?.querySelector("pre")?.textContent).toBe('{"html":"<b>hi</b>"}');
  });

  it("links to the producing Run and shows the SourceJob id only when provenance exists", async () => {
    await render({ source: makeSource(), analysisSchema: null, workspaceKey: "ws-1" });
    expect(document.querySelector("[data-testid='source-run-link']")).toBeNull();
    expect(text()).not.toContain("job-1");

    await render({ source: makeSource({ runId: "run-1", sourceJobId: "job-1" }), analysisSchema: null, workspaceKey: "ws-1" });
    const link = document.querySelector("[data-testid='source-run-link']");
    expect(link?.getAttribute("href")).toBe("/projects/instance-1/agents/%40opengroow%2Fseo/logs?runId=run-1");
    expect(text()).toContain("job-1");
  });

  it("labels analysis fields from schema titles, falling back to humanized keys", async () => {
    await render({
      source: makeSource({ analysis: { search_volume: 900, monthlyTrend: "up" } }),
      analysisSchema: {
        type: "object",
        properties: { search_volume: { type: "integer", title: "Monthly searches" } },
      },
    });
    expect(text()).toContain("Source analysis");
    expect(text()).toContain("Monthly searches");
    expect(text()).toContain("900");
    expect(text()).toContain("Monthly trend");
  });

  it("renders links, nested objects (collapsible) and arrays of objects as tables", async () => {
    await render({
      source: makeSource({
        analysis: {
          url: "https://example.com/post",
          tags: ["a", "b"],
          author: { name: "Ann", followers: 12 },
          comments: [
            { user: "bob", text: "nice" },
            { user: "eve", text: "cool" },
          ],
        },
      }),
      analysisSchema: {
        type: "object",
        properties: {
          comments: { type: "array", items: { type: "object", properties: { user: { type: "string", title: "Commenter" } } } },
        },
      },
    });
    const link = Array.from(document.querySelectorAll("a")).find((a) => a.getAttribute("href") === "https://example.com/post");
    expect(link).toBeDefined();
    expect(link?.getAttribute("rel")).toContain("noreferrer");

    expect(document.querySelectorAll("details").length).toBeGreaterThanOrEqual(1);
    expect(text()).toContain("Ann");
    expect(text()).toContain("Followers");

    const headers = Array.from(document.querySelectorAll("table th")).map((th) => th.textContent);
    expect(headers).toEqual(["Commenter", "Text"]);
    expect(document.querySelectorAll("table tbody tr")).toHaveLength(2);
  });

  it("shows an undocumented analysis readably", async () => {
    await render({
      source: makeSource({ analysis: { hook_style: "question", nested: { deep_value: true } } }),
      analysisSchema: null,
    });
    expect(text()).toContain("Hook style");
    expect(text()).toContain("question");
    expect(text()).toContain("Deep value");
    expect(text()).toContain("Yes");
  });

  it("shows the processing status and a retry control only for failed", async () => {
    const retryButton = () => Array.from(document.querySelectorAll("button")).find((b) => b.textContent === "Retry");
    for (const [status, label, hasRetry] of [
      ["processing", "Ingestion", false],
      ["ready", "Ready", false],
      ["failed", "Failed", true],
      ["unavailable", "Unavailable", false],
    ] as const) {
      await render({ source: makeSource({ status }), analysisSchema: null });
      expect(text()).toContain(label);
      expect(retryButton() !== undefined).toBe(hasRetry);
    }
  });

  it("retries a failed Source with its id", async () => {
    retryMock.mockResolvedValue(undefined);
    await render({ source: makeSource({ status: "failed" }), analysisSchema: null });
    const button = Array.from(document.querySelectorAll("button")).find((b) => b.textContent === "Retry");
    await act(async () => {
      button!.click();
    });
    expect(retryMock).toHaveBeenCalledWith({ sourceId: "src-1" });
  });

  describe("Force production (issue #535: scoring/planning now read Sources)", () => {
    const socialSource = (overrides: Partial<Record<string, unknown>> = {}) =>
      makeSource({
        templateId: "@opengroow/social-engagement",
        sourceId: "instagram-reel",
        analysis: { creativeFeatures: { mediaType: "video" } },
        ...overrides,
      });
    const button = () =>
      Array.from(document.querySelectorAll("button")).find((b) => /Force production|Produce again/.test(b.textContent ?? ""));

    it("starts production for a ready video or carousel social Source, by Source id", async () => {
      forceProductionMock.mockResolvedValue(undefined);
      await render({ source: socialSource(), analysisSchema: null });
      expect(button()?.textContent).toBe("Force production");
      await act(async () => {
        button()!.click();
      });
      expect(forceProductionMock).toHaveBeenCalledWith({ sourceId: "src-1" });
    });

    it("offers to produce again once selected", async () => {
      await render({ source: socialSource({ selectedAt: 1 }), analysisSchema: null });
      expect(button()?.textContent).toBe("Produce again");
    });

    it("is not offered for an image, an unenriched, a non-ready or a non-social Source", async () => {
      await render({ source: socialSource({ analysis: { creativeFeatures: { mediaType: "image" } } }), analysisSchema: null });
      expect(button()).toBeUndefined();
      await render({ source: socialSource({ analysis: {} }), analysisSchema: null });
      expect(button()).toBeUndefined();
      await render({ source: socialSource({ status: "processing" }), analysisSchema: null });
      expect(button()).toBeUndefined();
      await render({ source: makeSource({ analysis: { creativeFeatures: { mediaType: "video" } } }), analysisSchema: null });
      expect(button()).toBeUndefined();
    });
  });

  it("explains a retried Source waits for the next run of the Agent's job", async () => {
    await render({ source: makeSource({ status: "processing", retryRequested: true }), analysisSchema: null });
    expect(text()).toContain("Ingestion");
    expect(text()).toContain("next run");
    await render({ source: makeSource({ status: "processing" }), analysisSchema: null });
    expect(text()).not.toContain("next run");
  });

  it("links directly to the production Mission, not the retired routing Mission", async () => {
    await render({ source: makeSource({ productionMissionId: "mission-42" }), analysisSchema: null });
    const link = document.querySelector("[data-testid='source-production-mission-link']");
    expect(link?.getAttribute("href")).toBe("/projects/instance-1/missions/mission-42");
    expect(text()).toContain("View production Mission");
    expect(text()).not.toContain("delegateMissionId");
  });
});
