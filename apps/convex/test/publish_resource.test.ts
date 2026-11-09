import { afterEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import { internal } from "../_generated/api";
import schema from "../schema";
import type { Id } from "../_generated/dataModel";
import { mergePublishResource } from "../mission_dispatcher/publish_resource";
import { decideReconciliation } from "../mission_dispatcher/reconciliation";
import { buildMissionReviewProjection } from "../mission_review";
import { fixtureTemplate, useTemplateRegistry } from "./helpers/template_registry.helpers";
import type { AgentManifest, PublishDeclaration } from "@opengroow/agent-templates";

// Issue #26, ADR-069: a Template with an asynchronous MCP (produce, poll, then
// fetch) reaches the Publisher. The Agent writes the text part of the
// publishable in its `in_progress` RunResult; when the External Job completes,
// OpenGroow calls `publish.resource.tool` once and merges the media.

const modules = {
  "../_generated/api.ts": () => import("../_generated/api.js"),
  "../commands.ts": () => import("../commands.js"),
  "../commands_node.ts": () => import("../commands_node.js"),
  "../connect_tickets.ts": () => import("../connect_tickets.js"),
  "../connect_tickets_node.ts": () => import("../connect_tickets_node.js"),
  "../events.ts": () => import("../events.js"),
  "../health.ts": () => import("../health.js"),
  "../http.ts": () => import("../http.js"),
  "../instances.ts": () => import("../instances.js"),
  "../instances_node.ts": () => import("../instances_node.js"),
  "../missions.ts": () => import("../missions.js"),
  "../runs.ts": () => import("../runs.js"),
  "../project_agents.ts": () => import("../project_agents.js"),
  "../project_agents_node.ts": () => import("../project_agents_node.js"),
  "../runtime_commands_node.ts": () => import("../runtime_commands_node.js"),
  "../mission_dispatcher.ts": () => import("../mission_dispatcher.js"),
  "../mission_dispatcher_node.ts": () => import("../mission_dispatcher_node.js"),
};

const INSTANCE_ID = "inst-resource";
const TEMPLATE_ID = "@acme/short-video";
const OWNER_ID = "owner-resource";
const DRAFT = { kind: "video", caption: "Hello", title: "My video", tags: ["a"] } as const;

const declaration = (resource: PublishDeclaration["resource"], extra: Partial<PublishDeclaration> = {}) =>
  ({ kind: "video", resource, ...extra }) as PublishDeclaration & { resource: NonNullable<PublishDeclaration["resource"]> };

describe("mergePublishResource", () => {
  const merge = (
    decl: ReturnType<typeof declaration>,
    toolOutput: unknown,
    draft: unknown = DRAFT,
  ) => mergePublishResource({ missionType: "make", declaration: decl, draft, toolOutput });

  it("merges the recommended media names into the Agent's text part", () => {
    const result = merge(declaration({ tool: "get_video" }), {
      videoUrl: "https://cdn.example.com/v.mp4",
      coverUrl: "https://cdn.example.com/c.png",
    });
    expect(result).toEqual({
      ok: true,
      publishable: { ...DRAFT, videoUrl: "https://cdn.example.com/v.mp4", coverUrl: "https://cdn.example.com/c.png" },
    });
  });

  it("reads other names through resource.map, with [*] for the ordered slides", () => {
    const result = mergePublishResource({
      missionType: "make",
      declaration: { kind: "carousel", resource: { tool: "get", map: { slideUrls: "data.slides[*].url" } } },
      draft: { kind: "carousel", caption: "c" },
      toolOutput: { data: { slides: [{ url: "https://a.example.com/1.png" }, { url: "https://a.example.com/2.png" }] } },
    });
    expect(result).toEqual({
      ok: true,
      publishable: {
        kind: "carousel",
        caption: "c",
        slideUrls: ["https://a.example.com/1.png", "https://a.example.com/2.png"],
      },
    });
  });

  it("takes variants (images and text per service) when the tool returns them", () => {
    const output = { variants: { instagram: { slideUrls: ["https://a.example.com/1.png"], caption: "ig" } } };
    const result = mergePublishResource({
      missionType: "make",
      declaration: { kind: "carousel", resource: { tool: "get_carousel" } },
      draft: { kind: "carousel", caption: "default" },
      toolOutput: output,
    });
    expect(result).toEqual({ ok: true, publishable: { kind: "carousel", caption: "default", variants: output.variants } });
  });

  it("fails with one message when the tool returns neither slideUrls nor variants", () => {
    const result = mergePublishResource({
      missionType: "make",
      declaration: { kind: "carousel", resource: { tool: "get_carousel" } },
      draft: { kind: "carousel", caption: "c" },
      toolOutput: {},
    });
    expect(result).toEqual({
      ok: false,
      message: 'publishable.slideUrls is missing: tool "get_carousel" returned nothing at "slideUrls" nor at "variants"',
    });
  });

  it("never lets the tool overwrite the Agent's text fields", () => {
    const result = merge(declaration({ tool: "get_video" }), {
      videoUrl: "https://cdn.example.com/v.mp4",
      caption: "from the tool",
      title: "from the tool",
    });
    expect(result).toMatchObject({ ok: true, publishable: { caption: "Hello", title: "My video" } });
  });

  it("fails per field when a required media is missing, keeping nothing", () => {
    const result = merge(declaration({ tool: "get_video" }), { coverUrl: "https://cdn.example.com/c.png" });
    expect(result).toEqual({
      ok: false,
      message: 'publishable.videoUrl is missing: tool "get_video" returned nothing at "videoUrl"',
    });
  });

  it("fails per field when a media is not a valid URL", () => {
    const result = merge(declaration({ tool: "get_video" }), { videoUrl: "not a url" });
    expect(result).toMatchObject({ ok: false });
    expect((result as { message: string }).message).toContain("publishable.videoUrl");
  });

  it("enforces publish.require on the merged result", () => {
    const result = merge(declaration({ tool: "get_video" }, { require: ["coverUrl"] }), {
      videoUrl: "https://cdn.example.com/v.mp4",
    });
    expect(result).toMatchObject({ ok: false });
    expect((result as { message: string }).message).toContain("artifact.publishable.coverUrl is required");
  });

  it("rejects a draft carrying a media URL: the Agent never writes one", () => {
    const result = merge(
      declaration({ tool: "get_video" }),
      { videoUrl: "https://cdn.example.com/v.mp4" },
      { ...DRAFT, videoUrl: "https://agent.example.com/v.mp4" },
    );
    expect(result).toMatchObject({ ok: false });
  });
});

describe("decideReconciliation — in_progress with publish.resource", () => {
  const ctx = (publish?: { kind: string; resource?: unknown }) => ({
    parent: { kind: "mission" as const, missionId: "m" as Id<"missions"> },
    runId: "r" as Id<"runs">,
    missionType: "make",
    retryableFailureCount: 0,
    ...(publish ? { publish } : {}),
  });
  const snapshot = (body: unknown) =>
    ({
      execResult: { ok: true },
      readResult: { ok: true, data: { content: JSON.stringify(body), found: true } },
      resultReadCommandId: "c",
      timedOut: false,
      salvageTimedOut: false,
      finalReadCommandId: null,
      finalReadResult: null,
      maxMs: 1,
    }) as unknown as Parameters<typeof decideReconciliation>[0];
  const inProgress = {
    status: "in_progress",
    summary: "started",
    reviewQuestions: [],
    job: { mcpServer: "mcp", jobId: "j1", jobType: "produce" },
  };

  it("keeps the text part of the publishable on the awaiting job", () => {
    const decision = decideReconciliation(
      snapshot({ ...inProgress, publishable: DRAFT }),
      ctx({ kind: "video", resource: { tool: "get_video" } }),
    );
    expect(decision).toMatchObject({ type: "markAwaitingJob", job: { jobId: "j1", publishableDraft: DRAFT } });
  });

  it("asks the Agent for the text part when it is missing", () => {
    const decision = decideReconciliation(snapshot(inProgress), ctx({ kind: "video", resource: { tool: "get_video" } }));
    expect(JSON.stringify(decision)).toContain("publishable is required");
  });

  it("rejects a media URL written by the Agent", () => {
    const decision = decideReconciliation(
      snapshot({ ...inProgress, publishable: { ...DRAFT, videoUrl: "https://a.example.com/v.mp4" } }),
      ctx({ kind: "video", resource: { tool: "get_video" } }),
    );
    expect(decision.type).not.toBe("markAwaitingJob");
  });

  it("is unchanged for a Mission type without resource", () => {
    expect(decideReconciliation(snapshot(inProgress), ctx({ kind: "video" }))).toMatchObject({ type: "markAwaitingJob" });
  });
});

describe("review projection of a Mission type with publish", () => {
  const manifest = {
    id: TEMPLATE_ID,
    name: "T",
    description: "d",
    category: "c",
    mcpServers: [],
    missionTypes: [
      {
        type: "make",
        label: "Make",
        payload: "{}",
        agentsMd: "make.md",
        review: { kind: "video", server: "mcp", path: "/videos/{id}/final", actions: [] },
      },
    ],
  } as unknown as AgentManifest;
  const lastResult = { status: "needs_human_review", summary: "", reviewQuestions: [], artifact: { external: { service: "mcp", id: "j1" } } };
  const publish = { target: null, targets: [], unmappedTargets: [], publisherReady: true } as never;

  it("does not expose the review.path content: the media comes from the publishable", () => {
    const projection = buildMissionReviewProjection(manifest, { status: "to_validate", missionType: "make", lastResult }, publish);
    expect(projection.content).toBeNull();
    expect(projection.artifact.available).toBe(true);
    expect(projection.errors).toEqual([]);
  });

  it("still exposes it for a Mission type without publish", () => {
    const projection = buildMissionReviewProjection(manifest, { status: "to_validate", missionType: "make", lastResult });
    expect(projection.content).toMatchObject({ kind: "video", source: "external", available: true });
  });
});

describe("pollExternalJobs — publish.resource", () => {
  const manifest = {
    mcpServers: [{ name: "mcp", transport: "streamable-http" as const, url: "http://localhost:4300/mcp" }],
    missionTypes: [
      {
        type: "make",
        label: "Make",
        payload: "{}",
        agentsMd: "make.md",
        publish: { kind: "video" as const, resource: { tool: "get_video" } },
      },
    ],
    externalJobsByMissionType: {
      make: {
        produce: {
          server: "mcp",
          mcpTool: "get_run_status",
          statusField: "status",
          terminalStates: { completed: ["completed"], failed: ["failed"] },
          resultStatus: "needs_human_review" as const,
          artifactKind: "video" as const,
          onComplete: "terminal" as const,
        },
      },
    },
  };
  useTemplateRegistry([INSTANCE_ID], [fixtureTemplate(TEMPLATE_ID, manifest)]);
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function seed(t: ReturnType<typeof convexTest>, draft: unknown = DRAFT) {
    return await t.run(async (ctx) => {
      const now = Date.now();
      const missionId = await ctx.db.insert("missions", {
        ownerId: OWNER_ID,
        instanceId: INSTANCE_ID,
        templateId: TEMPLATE_ID,
        type: "make",
        payload: {},
        status: "doing",
        createdAt: now,
        updatedAt: now,
      });
      const runId = await ctx.db.insert("runs", {
        missionId,
        ownerId: OWNER_ID,
        instanceId: INSTANCE_ID,
        templateId: TEMPLATE_ID,
        agentName: "short-video",
        sessionKey: `mega-mission-${missionId}`,
        status: "awaiting_job",
        mcpJob: {
          serverName: "mcp",
          jobId: "job-1",
          summary: "Video rendered.",
          reviewQuestions: ["OK?"],
          jobType: "produce",
          missionType: "make",
          publishableDraft: draft,
        },
        dispatchedAt: now,
        createdAt: now,
        updatedAt: now,
      });
      return { runId, missionId };
    });
  }

  /** A fake MCP: tools/call answers by tool name. */
  function fakeMcp(tools: Record<string, () => unknown>) {
    const calls: Array<{ tool: string; args: Record<string, unknown> }> = [];
    const mockFetch = vi.fn(async (_url: string, init: RequestInit) => {
      const { params } = JSON.parse(init.body as string) as { params: { name: string; arguments: Record<string, unknown> } };
      calls.push({ tool: params.name, args: params.arguments });
      const handler = tools[params.name];
      if (!handler) throw new Error(`unexpected tool ${params.name}`);
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        headers: { get: () => "application/json" },
        json: async () => ({ result: { content: [{ type: "text", text: JSON.stringify(handler()) }], isError: false } }),
      };
    });
    vi.stubGlobal("fetch", mockFetch);
    return calls;
  }

  const media = { videoUrl: "https://cdn.example.com/v.mp4", coverUrl: "https://cdn.example.com/c.png" };

  it("calls the resource tool once, merges the media and reaches needs_human_review with a valid publishable", async () => {
    const t = convexTest(schema, modules);
    const { runId, missionId } = await seed(t);
    const calls = fakeMcp({ get_run_status: () => ({ status: "completed" }), get_video: () => media });

    await t.action(internal.mission_dispatcher_node.pollExternalJobs, {});
    // A replayed tick must not call the tool again: the Run is no longer awaiting.
    await t.action(internal.mission_dispatcher_node.pollExternalJobs, {});

    expect(calls.filter((c) => c.tool === "get_video")).toEqual([{ tool: "get_video", args: { runId: "job-1" } }]);
    await t.run(async (ctx) => {
      const run = await ctx.db.get(runId);
      expect(run?.status).toBe("completed");
      expect((await ctx.db.get(missionId))?.status).toBe("to_validate");
      const result = run?.result;
      expect(result?.status).toBe("needs_human_review");
      const artifact = result && "artifact" in result ? result.artifact : undefined;
      expect(artifact?.publishable).toEqual({ ...DRAFT, ...media });
    });
  });

  it("fails the Mission with a per-field message when a media is missing, keeping no partial publishable", async () => {
    const t = convexTest(schema, modules);
    const { runId } = await seed(t);
    fakeMcp({ get_run_status: () => ({ status: "completed" }), get_video: () => ({ coverUrl: media.coverUrl }) });

    await t.action(internal.mission_dispatcher_node.pollExternalJobs, {});

    await t.run(async (ctx) => {
      const run = await ctx.db.get(runId);
      expect(run?.status).toBe("failed");
      expect(run?.errorMessage).toContain("publishable.videoUrl is missing");
      expect(run?.result).toBeUndefined();
    });
  });

  it("fails the Mission when the resource tool fails", async () => {
    const t = convexTest(schema, modules);
    const { runId } = await seed(t);
    fakeMcp({
      get_run_status: () => ({ status: "completed" }),
      get_video: () => {
        throw new Error("boom");
      },
    });

    await t.action(internal.mission_dispatcher_node.pollExternalJobs, {});

    await t.run(async (ctx) => {
      const run = await ctx.db.get(runId);
      expect(run?.status).toBe("failed");
      expect(run?.errorMessage).toContain("get_video");
    });
  });

  it("does not call the resource tool while the job is still running", async () => {
    const t = convexTest(schema, modules);
    const { runId } = await seed(t);
    const calls = fakeMcp({ get_run_status: () => ({ status: "running" }), get_video: () => media });

    await t.action(internal.mission_dispatcher_node.pollExternalJobs, {});

    expect(calls.map((c) => c.tool)).toEqual(["get_run_status"]);
    await t.run(async (ctx) => {
      expect((await ctx.db.get(runId))?.status).toBe("awaiting_job");
    });
  });
});
