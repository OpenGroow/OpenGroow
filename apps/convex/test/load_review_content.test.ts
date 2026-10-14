import { insertInstance } from "./instance_fixture";
import { describe, expect, it, vi, afterEach } from "vitest";
import { convexTest } from "convex-test";
import { api } from "../_generated/api";
import schema from "../schema";
import {
  RUNTIME_WORKSPACE_FILE_READ_RESULT,
  buildRuntimeResultEventId,
} from "@opengroow/protocol";

import { useTemplateRegistry } from "./helpers/template_registry.helpers";
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
  "../missions_node.ts": () => import("../missions_node.js"),
  "../runs.ts": () => import("../runs.js"),
  "../project_agents.ts": () => import("../project_agents.js"),
  "../project_agents_node.ts": () => import("../project_agents_node.js"),
  "../runtime_commands_node.ts": () => import("../runtime_commands_node.js"),
};

const INSTANCE_ID = "openclaw-instance-lrc-1";
const TEMPLATE_ID = "@opengroow/seo";
const OWNER = { name: "Owner", email: "o@e.com", tokenIdentifier: "test|lrc-1", subject: "owner-lrc-1" };
const OTHER = { name: "Other", email: "x@e.com", tokenIdentifier: "test|other-lrc", subject: "other-lrc-1" };

function mockFetchContent(content: string) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ content }),
    }),
  );
}

function mockFetchError(status = 500) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: false,
      status,
      statusText: "Internal Server Error",
    }),
  );
}

async function seedInstance(t: ReturnType<typeof convexTest>) {
  const isoNow = new Date().toISOString();
  await t.run(async (ctx) => {
    await insertInstance(ctx, {
      jobId: `job-${INSTANCE_ID}`,
      status: "running",
      runtimeStatus: "linked",
      runtimeReady: true,
      createdAt: isoNow,
      openclawId: INSTANCE_ID,
      updatedAt: isoNow,
      userId: OWNER.subject,
    });
  });
}

async function seedProjectAgent(
  t: ReturnType<typeof convexTest>,
  config: Record<string, unknown> = { seoProjectId: "proj-lrc", apiKey: "key-lrc" },
) {
  const now = Date.now();
  await t.run(async (ctx) => {
    await ctx.db.insert("projectAgents", {
      instanceId: INSTANCE_ID,
      templateId: TEMPLATE_ID,
      status: "active",
      mcpServerKeys: ["article-mcp"],
      config,
      createdAt: now,
      updatedAt: now,
    });
  });
}

type SeedMissionOptions = {
  /** Use new generic artifact shape with `external.id` */
  external?: { service: string; id: string };
  /** No artifact at all */
  noArtifact?: boolean;
};

async function seedMission(
  t: ReturnType<typeof convexTest>,
  opts: SeedMissionOptions = {},
) {
  const now = Date.now();
  const { external, noArtifact } = opts;

  let artifact: Record<string, unknown> | undefined = undefined;
  if (!noArtifact) {
    if (external) {
      artifact = {
        kind: "markdown",
        external: { service: external.service, id: external.id },
        metadata: { keyword: "octopus", title: "Best Octopus Article" },
      };
    } else {
      // default: generic shape
      artifact = {
        kind: "markdown",
        external: { service: "article-mcp", id: "art-lrc-default" },
        metadata: { keyword: "octopus" },
      };
    }
  }

  return t.run(async (ctx) => {
    return ctx.db.insert("missions", {
      ownerId: OWNER.subject,
      instanceId: INSTANCE_ID,
      templateId: TEMPLATE_ID,
      type: "create_article",
      payload: {},
      status: "to_validate",
      lastResult: {
        status: "needs_human_review",
        summary: "Article ready for review",
        reviewQuestions: ["Is it ready?"],
        ...(artifact !== undefined ? { artifact } : {}),
      },
      createdAt: now,
      updatedAt: now,
    });
  });
}

describe("missions_node.loadReviewContent", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // ── Happy path: generic artifact shape (external.id) ──────────────────────

  it("returns markdown content from article-mcp using artifact.external.id", async () => {
    mockFetchContent("# My SEO Article\n\nGreat content.");
    const t = convexTest(schema, modules);
    await seedInstance(t);
    const missionId = await seedMission(t, {
      external: { service: "article-mcp", id: "art-generic-999" },
    });
    await seedProjectAgent(t);

    const result = await t
      .withIdentity(OWNER)
      .action(api.missions_node.loadReviewContent, { missionId });

    expect(result.content).toBe("# My SEO Article\n\nGreat content.");
    expect(result.kind).toBe("markdown");
  });

  it("returns the declared SEO cover URL alongside the article content", async () => {
    mockFetchContent("# My SEO Article");
    const t = convexTest(schema, modules);
    await seedInstance(t);
    const missionId = await seedMission(t, {
      external: { service: "article-mcp", id: "art-cover-123" },
    });
    await seedProjectAgent(t);

    const result = await t
      .withIdentity(OWNER)
      .action(api.missions_node.loadReviewContent, { missionId });

    expect(result.coverUrl).toBe("http://localhost:4000/images/art-cover-123/cover");
  });

  it("fetches using the article id from artifact.external.id", async () => {
    mockFetchContent("# Article Content");
    const t = convexTest(schema, modules);
    await seedInstance(t);
    const missionId = await seedMission(t, {
      external: { service: "article-mcp", id: "art-specific-777" },
    });
    await seedProjectAgent(t);

    await t.withIdentity(OWNER).action(api.missions_node.loadReviewContent, { missionId });

    const [url] = vi.mocked(fetch).mock.calls[0];
    expect(String(url)).toContain("art-specific-777");
    expect(String(url)).toContain("/articles/");
  });

  it("sends the projectAgent apiKey as the Authorization header", async () => {
    mockFetchContent("# Article");
    const t = convexTest(schema, modules);
    await seedInstance(t);
    const missionId = await seedMission(t);
    await seedProjectAgent(t, { apiKey: "my-secret-key" });

    await t.withIdentity(OWNER).action(api.missions_node.loadReviewContent, { missionId });

    expect(fetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer my-secret-key" }),
      }),
    );
  });

  it("includes metadata from artifact in the response", async () => {
    mockFetchContent("# Article");
    const t = convexTest(schema, modules);
    await seedInstance(t);
    const missionId = await seedMission(t, {
      external: { service: "article-mcp", id: "art-meta-test" },
    });
    await seedProjectAgent(t);

    const result = await t.withIdentity(OWNER).action(api.missions_node.loadReviewContent, { missionId });

    expect(result.metadata).toMatchObject({ keyword: "octopus" });
  });

  // ── Strict contract: no legacy metadata readers ───────────────────────────

  it("throws when artifact has no external.id (legacy metadata.articleId only — unmigrated)", async () => {
    const t = convexTest(schema, modules);
    await seedInstance(t);
    const now = Date.now();
    // Simulate a pre-migration artifact with only metadata.articleId and no external.id.
    // convex-test bypasses the Zod validator, so we can insert this shape directly.
    const missionId = await t.run(async (ctx) => {
      return ctx.db.insert("missions", {
        ownerId: OWNER.subject,
        instanceId: INSTANCE_ID,
        templateId: TEMPLATE_ID,
        type: "create_article",
        payload: {},
        status: "to_validate",
        lastResult: {
          status: "needs_human_review",
          summary: "Article ready",
          reviewQuestions: [],
          // Legacy shape — no external.id
          artifact: { metadata: { articleId: "art-legacy-unmigrated", keyword: "octopus" } },
        },
        createdAt: now,
        updatedAt: now,
      });
    });
    await seedProjectAgent(t);

    await expect(
      t.withIdentity(OWNER).action(api.missions_node.loadReviewContent, { missionId }),
    ).rejects.toThrow(/No external identifier/i);
  });

  // ── Ownership and auth failures ───────────────────────────────────────────

  it("throws when not authenticated", async () => {
    const t = convexTest(schema, modules);
    await seedInstance(t);
    const missionId = await seedMission(t);

    await expect(
      t.action(api.missions_node.loadReviewContent, { missionId }),
    ).rejects.toThrow(/Authentication/i);
  });

  it("throws Forbidden when a different user requests review content", async () => {
    mockFetchContent("# Article");
    const t = convexTest(schema, modules);
    await seedInstance(t);
    const missionId = await seedMission(t);
    await seedProjectAgent(t);

    await expect(
      t.withIdentity(OTHER).action(api.missions_node.loadReviewContent, { missionId }),
    ).rejects.toThrow(/Forbidden/i);
  });

  // ── Missing artifact ──────────────────────────────────────────────────────

  it("throws when mission has no artifact", async () => {
    const t = convexTest(schema, modules);
    await seedInstance(t);
    const missionId = await seedMission(t, { noArtifact: true });

    await expect(
      t.withIdentity(OWNER).action(api.missions_node.loadReviewContent, { missionId }),
    ).rejects.toThrow(/no artifact/i);
  });

  it("throws when artifact has no external.id (metadata-only, no identity field)", async () => {
    const t = convexTest(schema, modules);
    await seedInstance(t);
    const now = Date.now();
    const missionId = await t.run(async (ctx) => {
      return ctx.db.insert("missions", {
        ownerId: OWNER.subject,
        instanceId: INSTANCE_ID,
        templateId: TEMPLATE_ID,
        type: "create_article",
        payload: {},
        status: "to_validate",
        lastResult: {
          status: "needs_human_review",
          summary: "Article ready",
          reviewQuestions: [],
          artifact: { metadata: { keyword: "no-id" } },
        },
        createdAt: now,
        updatedAt: now,
      });
    });

    await expect(
      t.withIdentity(OWNER).action(api.missions_node.loadReviewContent, { missionId }),
    ).rejects.toThrow(/No external identifier/i);
  });

  // ── External service error ────────────────────────────────────────────────

  it("throws when the external service returns an error", async () => {
    mockFetchError(500);
    const t = convexTest(schema, modules);
    await seedInstance(t);
    const missionId = await seedMission(t);
    await seedProjectAgent(t);

    await expect(
      t.withIdentity(OWNER).action(api.missions_node.loadReviewContent, { missionId }),
    ).rejects.toThrow();
  });
});

describe("missions_node.getReview", () => {
  it("returns the resolved review projection without template transport details", async () => {
    const t = convexTest(schema, modules);
    await seedInstance(t);
    const missionId = await seedMission(t, {
      external: { service: "article-mcp", id: "art-review-projection-1" },
    });

    const result = await t
      .withIdentity(OWNER)
      .action(api.missions_node.getReview, { missionId });

    expect(result.content).toEqual({
      kind: "markdown",
      source: "external",
      available: true,
    });
    expect(result.actions.map((action) => action.key)).toEqual([
      "approve",
      "publish",
      "reject",
    ]);
    expect(result.actions.find((action) => action.key === "approve")).toMatchObject({
      label: "Approve",
      enabled: true,
    });
    expect(result.defaultActionKey).toBe("approve");
    expect(JSON.stringify(result)).not.toContain("article-mcp");
    expect(JSON.stringify(result)).not.toContain("/articles/");
  });

  it("returns a bounded unavailable projection for a mission without an artifact", async () => {
    const t = convexTest(schema, modules);
    await seedInstance(t);
    const missionId = await seedMission(t, { noArtifact: true });

    const result = await t
      .withIdentity(OWNER)
      .action(api.missions_node.getReview, { missionId });

    expect(result.artifact.available).toBe(false);
    expect(result.content).toBeNull();
    expect(result.errors).toContain("No artifact available for this mission");
  });
});

// ---------------------------------------------------------------------------
// Video template: loadReviewContent happy path and contract (ADR-020)
// ---------------------------------------------------------------------------

const VIDEO_INSTANCE_ID = "openclaw-instance-video-lrc-1";
const VIDEO_TEMPLATE_ID = "@opengroow/video-demo";

useTemplateRegistry(
  [INSTANCE_ID, VIDEO_INSTANCE_ID, "openclaw-hello-lrc-1"],
  [TEMPLATE_ID, VIDEO_TEMPLATE_ID, "@opengroow/hello"],
);
const VIDEO_OWNER = {
  name: "VideoOwner",
  email: "v@e.com",
  tokenIdentifier: "test|video-lrc-1",
  subject: "owner-video-lrc-1",
};

async function seedVideoInstance(t: ReturnType<typeof convexTest>) {
  const isoNow = new Date().toISOString();
  await t.run(async (ctx) => {
    await insertInstance(ctx, {
      jobId: `job-${VIDEO_INSTANCE_ID}`,
      status: "running",
      runtimeStatus: "linked",
      runtimeReady: true,
      createdAt: isoNow,
      openclawId: VIDEO_INSTANCE_ID,
      updatedAt: isoNow,
      userId: VIDEO_OWNER.subject,
    });
  });
}

async function seedVideoProjectAgent(
  t: ReturnType<typeof convexTest>,
  config: Record<string, unknown> = { apiKey: "video-api-key" },
) {
  const now = Date.now();
  await t.run(async (ctx) => {
    await ctx.db.insert("projectAgents", {
      instanceId: VIDEO_INSTANCE_ID,
      templateId: VIDEO_TEMPLATE_ID,
      status: "active",
      mcpServerKeys: ["video-mcp"],
      config,
      createdAt: now,
      updatedAt: now,
    });
  });
}

async function seedVideoMission(
  t: ReturnType<typeof convexTest>,
  opts: { externalId?: string; noArtifact?: boolean; noExternal?: boolean } = {},
) {
  const now = Date.now();
  const { externalId = "run-uuid-video-42", noArtifact, noExternal } = opts;

  let artifact: Record<string, unknown> | undefined;
  if (!noArtifact) {
    if (noExternal) {
      // Artifact with no external.id — missing contract (should fail)
      artifact = { metadata: { someOtherKey: "value" } };
    } else {
      artifact = {
        kind: "video",
        external: { service: "video-mcp", id: externalId },
        metadata: { runId: externalId },
      };
    }
  }

  return t.run(async (ctx) => {
    return ctx.db.insert("missions", {
      ownerId: VIDEO_OWNER.subject,
      instanceId: VIDEO_INSTANCE_ID,
      templateId: VIDEO_TEMPLATE_ID,
      type: "lym_create_letter_video",
      payload: {},
      status: "to_validate",
      lastResult: {
        status: "needs_human_review",
        summary: "Video ready for review",
        reviewQuestions: ["Is the video ready to publish?"],
        ...(artifact !== undefined ? { artifact } : {}),
      },
      createdAt: now,
      updatedAt: now,
    });
  });
}

describe("missions_node.loadReviewContent — video template", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // ── Happy path: video artifact with external.id ───────────────────────────

  it("returns { kind: 'video', content: videoUrl } without fetching the media", async () => {
    const t = convexTest(schema, modules);
    await seedVideoInstance(t);
    const missionId = await seedVideoMission(t, { externalId: "run-video-happy-1" });
    await seedVideoProjectAgent(t);

    const result = await t
      .withIdentity(VIDEO_OWNER)
      .action(api.missions_node.loadReviewContent, { missionId });

    expect(result.kind).toBe("video");
    // content is the resolved URL — built from the review contract path template
    expect(result.content).toContain("run-video-happy-1");
    expect(result.content).toContain("/videos/");
    expect(result.content).toContain("/final");
  });

  it("does NOT call fetch for video content (URL is returned directly)", async () => {
    const mockFn = vi.fn();
    vi.stubGlobal("fetch", mockFn);
    const t = convexTest(schema, modules);
    await seedVideoInstance(t);
    const missionId = await seedVideoMission(t, { externalId: "run-no-fetch" });
    await seedVideoProjectAgent(t);

    await t.withIdentity(VIDEO_OWNER).action(api.missions_node.loadReviewContent, { missionId });

    expect(mockFn).not.toHaveBeenCalled();
  });

  it("builds the video URL from the video-mcp server origin", async () => {
    const t = convexTest(schema, modules);
    await seedVideoInstance(t);
    const missionId = await seedVideoMission(t, { externalId: "run-url-test-99" });
    await seedVideoProjectAgent(t);

    const result = await t
      .withIdentity(VIDEO_OWNER)
      .action(api.missions_node.loadReviewContent, { missionId });

    // The origin comes from video-mcp.activationUrl in the video manifest
    expect(result.content).toMatch(/^https?:\/\//);
    expect(result.content).toContain("run-url-test-99");
  });

  it("includes metadata from the artifact in the response", async () => {
    const t = convexTest(schema, modules);
    await seedVideoInstance(t);
    const missionId = await seedVideoMission(t, { externalId: "run-meta-check" });
    await seedVideoProjectAgent(t);

    const result = await t
      .withIdentity(VIDEO_OWNER)
      .action(api.missions_node.loadReviewContent, { missionId });

    expect(result.metadata).toMatchObject({ runId: "run-meta-check" });
  });

  // ── Missing artifact ──────────────────────────────────────────────────────

  it("throws when video mission has no artifact", async () => {
    const t = convexTest(schema, modules);
    await seedVideoInstance(t);
    const missionId = await seedVideoMission(t, { noArtifact: true });

    await expect(
      t.withIdentity(VIDEO_OWNER).action(api.missions_node.loadReviewContent, { missionId }),
    ).rejects.toThrow(/no artifact/i);
  });

  it("throws when video artifact has no external.id (metadata-only — unmigrated shape)", async () => {
    const t = convexTest(schema, modules);
    await seedVideoInstance(t);
    const missionId = await seedVideoMission(t, { noExternal: true });

    await expect(
      t.withIdentity(VIDEO_OWNER).action(api.missions_node.loadReviewContent, { missionId }),
    ).rejects.toThrow(/No external identifier/i);
  });

  // ── Strict contract: legacy metadata.runId not accepted ─────────────────

  it("throws when video artifact has only metadata.runId and no external.id (unmigrated legacy shape)", async () => {
    const t = convexTest(schema, modules);
    await seedVideoInstance(t);
    const now = Date.now();
    // Insert a legacy video artifact directly, bypassing the Zod validator.
    const missionId = await t.run(async (ctx) => {
      return ctx.db.insert("missions", {
        ownerId: VIDEO_OWNER.subject,
        instanceId: VIDEO_INSTANCE_ID,
        templateId: VIDEO_TEMPLATE_ID,
        type: "lym_create_letter_video",
        payload: {},
        status: "to_validate",
        lastResult: {
          status: "needs_human_review",
          summary: "Video ready",
          reviewQuestions: [],
          // Legacy shape: only metadata.runId, no external.id
          artifact: { metadata: { runId: "legacy-run-id-999" } },
        },
        createdAt: now,
        updatedAt: now,
      });
    });
    await seedVideoProjectAgent(t);

    await expect(
      t.withIdentity(VIDEO_OWNER).action(api.missions_node.loadReviewContent, { missionId }),
    ).rejects.toThrow(/No external identifier/i);
  });

  // ── Contract validation ───────────────────────────────────────────────────

  it("throws when template does not declare a review contract", async () => {
    // Use the 'hello' template which has no review contract.
    const now = Date.now();
    const isoNow = new Date().toISOString();
    const HELLO_INSTANCE = "openclaw-hello-lrc-1";
    const t = convexTest(schema, modules);

    await t.run(async (ctx) => {
      await insertInstance(ctx, {
        jobId: `job-${HELLO_INSTANCE}`,
        status: "running",
        runtimeStatus: "linked",
        runtimeReady: true,
        createdAt: isoNow,
        openclawId: HELLO_INSTANCE,
        updatedAt: isoNow,
        userId: VIDEO_OWNER.subject,
      });
    });

    const missionId = await t.run(async (ctx) => {
      return ctx.db.insert("missions", {
        ownerId: VIDEO_OWNER.subject,
        instanceId: HELLO_INSTANCE,
        templateId: "@opengroow/hello",
        type: "hello",
        payload: {},
        status: "to_validate",
        lastResult: {
          status: "needs_human_review",
          summary: "Hello result",
          reviewQuestions: [],
          artifact: {
            kind: "video",
            external: { service: "video-mcp", id: "run-hello-1" },
            metadata: {},
          },
        },
        createdAt: now,
        updatedAt: now,
      });
    });

    await expect(
      t.withIdentity(VIDEO_OWNER).action(api.missions_node.loadReviewContent, { missionId }),
    ).rejects.toThrow(/does not declare a review content contract/i);
  });
});

// ---------------------------------------------------------------------------
// internal_linking mission type: loadReviewContent uses /linking-jobs/{id}
// ---------------------------------------------------------------------------

describe("missions_node.loadReviewContent — internal_linking mission type", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function seedInternalLinkingMission(
    t: ReturnType<typeof convexTest>,
    jobId = "job-link-abc",
  ) {
    const now = Date.now();
    return t.run(async (ctx) => {
      return ctx.db.insert("missions", {
        ownerId: OWNER.subject,
        instanceId: INSTANCE_ID,
        templateId: TEMPLATE_ID,
        type: "internal_linking",
        payload: {},
        status: "to_validate",
        lastResult: {
          status: "needs_human_review",
          summary: "Internal linking PR created.",
          reviewQuestions: ["Does the PR look correct?"],
          artifact: {
            kind: "markdown",
            external: { service: "article-mcp", id: jobId },
            metadata: { prUrl: "https://github.com/example/repo/pull/42", since: "2026-06-13" },
          },
        },
        createdAt: now,
        updatedAt: now,
      });
    });
  }

  it("fetches from /linking-jobs/{id} for internal_linking missions (not /articles/{id})", async () => {
    mockFetchContent("## Internal Linking PR\n\nPR: https://github.com/example/repo/pull/42");
    const t = convexTest(schema, modules);
    await seedInstance(t);
    const missionId = await seedInternalLinkingMission(t, "job-link-fetch-1");
    await seedProjectAgent(t);

    await t.withIdentity(OWNER).action(api.missions_node.loadReviewContent, { missionId });

    const [url] = vi.mocked(fetch).mock.calls[0];
    expect(String(url)).toContain("/linking-jobs/job-link-fetch-1");
    expect(String(url)).not.toContain("/articles/");
  });

  it("returns markdown content from the linking job endpoint", async () => {
    const jobContent = "## Internal Linking PR\n\nPR: https://github.com/example/repo/pull/42";
    mockFetchContent(jobContent);
    const t = convexTest(schema, modules);
    await seedInstance(t);
    const missionId = await seedInternalLinkingMission(t, "job-link-content-1");
    await seedProjectAgent(t);

    const result = await t.withIdentity(OWNER).action(api.missions_node.loadReviewContent, { missionId });

    expect(result.kind).toBe("markdown");
    expect(result.content).toBe(jobContent);
  });

  it("includes artifact metadata (prUrl, since) in the response", async () => {
    mockFetchContent("## PR");
    const t = convexTest(schema, modules);
    await seedInstance(t);
    const missionId = await seedInternalLinkingMission(t, "job-link-meta-1");
    await seedProjectAgent(t);

    const result = await t.withIdentity(OWNER).action(api.missions_node.loadReviewContent, { missionId });

    expect(result.metadata).toMatchObject({
      prUrl: "https://github.com/example/repo/pull/42",
      since: "2026-06-13",
    });
  });
});

// ---------------------------------------------------------------------------
// Workspace artifact: external.service = "workspace"
// ---------------------------------------------------------------------------

const WORKSPACE_KEY = "ws-key-abc";
const WORKSPACE_FILE_PATH = "missions/mission-xyz/artifacts/run-42/report.json";
const WORKSPACE_ARTIFACT_CONTENT = "# Report\n\nWorkspace content here.";

async function seedInstanceWithWorkspace(t: ReturnType<typeof convexTest>) {
  const isoNow = new Date().toISOString();
  await t.run(async (ctx) => {
    await insertInstance(ctx, {
      jobId: `job-${INSTANCE_ID}`,
      status: "running",
      runtimeStatus: "linked",
      runtimeReady: true,
      createdAt: isoNow,
      openclawId: INSTANCE_ID,
      updatedAt: isoNow,
      userId: OWNER.subject,
    });
  });
}

async function seedProjectAgentWithWorkspace(
  t: ReturnType<typeof convexTest>,
  workspaceKey = WORKSPACE_KEY,
) {
  const now = Date.now();
  await t.run(async (ctx) => {
    await ctx.db.insert("projectAgents", {
      instanceId: INSTANCE_ID,
      templateId: TEMPLATE_ID,
      status: "active",
      mcpServerKeys: ["article-mcp"],
      workspaceKey,
      config: { seoProjectId: "proj-ws", apiKey: "key-ws" },
      createdAt: now,
      updatedAt: now,
    });
  });
}

async function seedWorkspaceMission(
  t: ReturnType<typeof convexTest>,
  filePath = WORKSPACE_FILE_PATH,
) {
  const now = Date.now();
  return t.run(async (ctx) => {
    return ctx.db.insert("missions", {
      ownerId: OWNER.subject,
      instanceId: INSTANCE_ID,
      templateId: TEMPLATE_ID,
      type: "create_article",
      payload: {},
      status: "to_validate",
      lastResult: {
        status: "needs_human_review",
        summary: "Workspace artifact ready",
        reviewQuestions: ["Looks good?"],
        artifact: {
          kind: "markdown",
          external: { service: "workspace", id: filePath },
          metadata: { keyword: "octopus", title: "Workspace Report" },
        },
      },
      createdAt: now,
      updatedAt: now,
    });
  });
}

/**
 * Simulate the runtime responding to a WORKSPACE_FILE_READ command.
 * Polls the DB until the command appears, then inserts the result event.
 * This is needed because the action enqueues the command asynchronously and
 * we must wait for it to appear before we can respond.
 */
async function simulateWorkspaceFileReadResult(
  t: ReturnType<typeof convexTest>,
  content: string,
  opts: { ok?: boolean; error?: string; pollIntervalMs?: number; timeoutMs?: number } = {},
) {
  const ok = opts.ok !== false;
  const pollIntervalMs = opts.pollIntervalMs ?? 50;
  const timeoutMs = opts.timeoutMs ?? 5000;
  const deadline = Date.now() + timeoutMs;

  // Poll until the command appears in the DB
  let cmd: { _id: string; instanceId: string; payload: unknown } | null = null;
  while (Date.now() < deadline) {
    cmd = await t.run(async (ctx) => {
      const commands = await ctx.db
        .query("commands")
        .filter((q) => q.eq(q.field("type"), "runtime.workspace.file.read"))
        .collect();
      return commands[commands.length - 1] ?? null;
    });
    if (cmd) break;
    await new Promise<void>((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  if (!cmd) throw new Error("Timed out waiting for workspace file read command to be enqueued");

  const p = cmd.payload as { workspaceKey?: string; filePath?: string };
  await t.run(async (ctx) => {
    const now = Date.now();
    await ctx.db.insert("events", {
      instanceId: cmd!.instanceId,
      eventId: buildRuntimeResultEventId(cmd!._id),
      type: RUNTIME_WORKSPACE_FILE_READ_RESULT,
      payload: {
        commandId: cmd!._id,
        instanceId: cmd!.instanceId,
        ok,
        error: opts.error,
        data: {
          workspaceKey: p.workspaceKey ?? "",
          filePath: p.filePath ?? "",
          title: "report.json",
          content,
        },
      },
      ts: now,
      createdAt: now,
    });
  });
}

describe("missions_node.loadReviewContent — workspace artifact (external.service = 'workspace')", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("enqueues a RUNTIME_WORKSPACE_FILE_READ command with the correct filePath", async () => {
    const t = convexTest(schema, modules);
    await seedInstanceWithWorkspace(t);
    const missionId = await seedWorkspaceMission(t, WORKSPACE_FILE_PATH);
    await seedProjectAgentWithWorkspace(t);

    // Run action and runtime simulation concurrently:
    // the simulation polls until the command is enqueued, seeds the result,
    // then the action's next poll finds the result and completes.
    await Promise.all([
      t.withIdentity(OWNER).action(api.missions_node.loadReviewContent, { missionId }),
      simulateWorkspaceFileReadResult(t, WORKSPACE_ARTIFACT_CONTENT),
    ]);

    const command = await t.run(async (ctx) => {
      const cmds = await ctx.db
        .query("commands")
        .filter((q) => q.eq(q.field("type"), "runtime.workspace.file.read"))
        .collect();
      return cmds[0];
    });

    expect(command).toBeDefined();
    const payload = command!.payload as { filePath: string; workspaceKey: string };
    expect(payload.filePath).toBe(WORKSPACE_FILE_PATH);
    expect(payload.workspaceKey).toBe(WORKSPACE_KEY);
  });

  it("returns the file content from the workspace when the command result arrives", async () => {
    const t = convexTest(schema, modules);
    await seedInstanceWithWorkspace(t);
    const missionId = await seedWorkspaceMission(t);
    await seedProjectAgentWithWorkspace(t);

    const [result] = await Promise.all([
      t.withIdentity(OWNER).action(api.missions_node.loadReviewContent, { missionId }),
      simulateWorkspaceFileReadResult(t, WORKSPACE_ARTIFACT_CONTENT),
    ]);

    expect(result.content).toBe(WORKSPACE_ARTIFACT_CONTENT);
    expect(result.kind).toBe("markdown");
  });

  it("includes artifact metadata in the response", async () => {
    const t = convexTest(schema, modules);
    await seedInstanceWithWorkspace(t);
    const missionId = await seedWorkspaceMission(t);
    await seedProjectAgentWithWorkspace(t);

    const [result] = await Promise.all([
      t.withIdentity(OWNER).action(api.missions_node.loadReviewContent, { missionId }),
      simulateWorkspaceFileReadResult(t, WORKSPACE_ARTIFACT_CONTENT),
    ]);

    expect(result.metadata).toMatchObject({ keyword: "octopus", title: "Workspace Report" });
  });

  it("does NOT call fetch for workspace artifacts", async () => {
    const mockFn = vi.fn();
    vi.stubGlobal("fetch", mockFn);

    const t = convexTest(schema, modules);
    await seedInstanceWithWorkspace(t);
    const missionId = await seedWorkspaceMission(t);
    await seedProjectAgentWithWorkspace(t);

    await Promise.all([
      t.withIdentity(OWNER).action(api.missions_node.loadReviewContent, { missionId }),
      simulateWorkspaceFileReadResult(t, WORKSPACE_ARTIFACT_CONTENT),
    ]);

    expect(mockFn).not.toHaveBeenCalled();
  });

  it("throws when projectAgent has no workspaceKey for a workspace artifact", async () => {
    const t = convexTest(schema, modules);
    await seedInstanceWithWorkspace(t);
    const missionId = await seedWorkspaceMission(t);
    // Seed without workspaceKey
    const now = Date.now();
    await t.run(async (ctx) => {
      await ctx.db.insert("projectAgents", {
        instanceId: INSTANCE_ID,
        templateId: TEMPLATE_ID,
        status: "active",
        mcpServerKeys: ["article-mcp"],
        config: { seoProjectId: "proj-ws", apiKey: "key-ws" },
        createdAt: now,
        updatedAt: now,
      });
    });

    await expect(
      t.withIdentity(OWNER).action(api.missions_node.loadReviewContent, { missionId }),
    ).rejects.toThrow(/workspace key/i);
  });

  it("non-workspace artifacts (article-mcp) still follow the existing HTTP fetch path", async () => {
    mockFetchContent("# SEO Article");
    const t = convexTest(schema, modules);
    await seedInstance(t);
    const missionId = await seedMission(t, {
      external: { service: "article-mcp", id: "art-nonws-999" },
    });
    await seedProjectAgent(t);

    const result = await t
      .withIdentity(OWNER)
      .action(api.missions_node.loadReviewContent, { missionId });

    expect(result.content).toBe("# SEO Article");
  });
});
