import { insertInstance } from "./instance_fixture";
import { describe, expect, it, vi, afterEach, beforeEach } from "vitest";

import { convexTest } from "convex-test";
import { api } from "../_generated/api";
import schema from "../schema";

import {
  officialFixtureTemplate,
  inMemoryRegistry,
  loadFixtureTemplate,
  useTemplateRegistry,
} from "./helpers/template_registry.helpers";
import { setTemplateRegistryForTests } from "../template_registry";

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

// ---------------------------------------------------------------------------
// Fixtures & helpers
// ---------------------------------------------------------------------------

const INSTANCE_ID = "openclaw-instance-pra-1";
const SEO_TEMPLATE_ID = "@opengroow/seo";
const VIDEO_TEMPLATE_ID = "@opengroow/video-demo";

useTemplateRegistry([INSTANCE_ID], [SEO_TEMPLATE_ID, VIDEO_TEMPLATE_ID]);

const OWNER = {
  name: "Owner",
  email: "o@e.com",
  tokenIdentifier: "test|pra-1",
  subject: "owner-pra-1",
};
const OTHER = {
  name: "Other",
  email: "x@e.com",
  tokenIdentifier: "test|other-pra",
  subject: "other-pra-1",
};

function mockFetchOk(responseBody: Record<string, unknown> = {}) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => responseBody,
    }),
  );
}

function mockFetchError(status = 500, statusText = "Internal Server Error") {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: false,
      status,
      statusText,
    }),
  );
}

function mockFetchErrorWithBody(
  status: number,
  statusText: string,
  body: Record<string, unknown>,
) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: false,
      status,
      statusText,
      json: async () => body,
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
  templateId: string,
  config: Record<string, unknown> = { apiKey: "key-pra" },
) {
  const now = Date.now();
  await t.run(async (ctx) => {
    await ctx.db.insert("projectAgents", {
      instanceId: INSTANCE_ID,
      templateId,
      status: "active",
      mcpServerKeys: [templateId === "video-demo" ? "video-mcp" : "article-mcp"],
      config,
      createdAt: now,
      updatedAt: now,
    });
  });
}

type SeedMissionOptions = {
  templateId?: string;
  type?: string;
  payload?: Record<string, unknown>;
  status?: "to_validate" | "approved" | "done";
  artifactShape?: "generic" | "legacy-article" | "legacy-run" | "none";
  externalId?: string;
};

function defaultMissionType(templateId: string): string {
  if (templateId === VIDEO_TEMPLATE_ID) return "lym_create_letter_video";
  return "create_article";
}

async function seedMission(
  t: ReturnType<typeof convexTest>,
  opts: SeedMissionOptions = {},
) {
  const {
    templateId = SEO_TEMPLATE_ID,
    status = "to_validate",
    artifactShape = "generic",
    externalId = templateId === "video-demo" ? "run-pra-video-1" : "art-pra-1",
    type = defaultMissionType(templateId),
    payload = templateId === VIDEO_TEMPLATE_ID ? { platforms: ["tiktok", "instagram"] } : {},
  } = opts;

  const now = Date.now();

  let artifact: Record<string, unknown> | undefined;
  if (artifactShape === "generic") {
    artifact = {
      kind: templateId === "video-demo" ? "video" : "markdown",
      external: {
        service: templateId === "video-demo" ? "video-mcp" : "article-mcp",
        id: externalId,
      },
      metadata: { keyword: "test-keyword", title: "Test Article" },
    };
  } else if (artifactShape === "legacy-article") {
    artifact = {
      metadata: { articleId: externalId, keyword: "test-keyword" },
    };
  } else if (artifactShape === "legacy-run") {
    artifact = {
      metadata: { runId: externalId },
    };
  }

  return t.run(async (ctx) => {
    return ctx.db.insert("missions", {
      ownerId: OWNER.subject,
      instanceId: INSTANCE_ID,
      templateId,
      type,
      payload,
      status,
      lastResult: {
        status: "needs_human_review",
        summary: "Ready for review",
        reviewQuestions: ["Is it ready?"],
        ...(artifact !== undefined ? { artifact } : {}),
      },
      createdAt: now,
      updatedAt: now,
    });
  });
}

// ---------------------------------------------------------------------------
// SEO approve (to_validate → approved)
// ---------------------------------------------------------------------------

describe("missions_node.performReviewAction — SEO approve", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns { ok: true } and transitions mission to approved", async () => {
    mockFetchOk();
    const t = convexTest(schema, modules);
    await seedInstance(t);
    const missionId = await seedMission(t, { templateId: SEO_TEMPLATE_ID });
    await seedProjectAgent(t, SEO_TEMPLATE_ID);

    const result = await t.withIdentity(OWNER).action(api.missions_node.performReviewAction, {
      missionId,
      actionKey: "approve",
    });

    expect(result).toEqual({ ok: true });

    const updated = await t.run(async (ctx) => ctx.db.get(missionId));
    expect(updated?.status).toBe("approved");
  });

  it("calls article-mcp POST /articles/{id}/approve with the article id", async () => {
    mockFetchOk();
    const t = convexTest(schema, modules);
    await seedInstance(t);
    const missionId = await seedMission(t, {
      templateId: SEO_TEMPLATE_ID,
      externalId: "art-specific-approve-1",
    });
    await seedProjectAgent(t, SEO_TEMPLATE_ID, { apiKey: "seo-api-key" });

    await t.withIdentity(OWNER).action(api.missions_node.performReviewAction, {
      missionId,
      actionKey: "approve",
    });

    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("/articles/art-specific-approve-1/approve"),
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("sends Authorization header with apiKey", async () => {
    mockFetchOk();
    const t = convexTest(schema, modules);
    await seedInstance(t);
    const missionId = await seedMission(t, { templateId: SEO_TEMPLATE_ID });
    await seedProjectAgent(t, SEO_TEMPLATE_ID, { apiKey: "bearer-token-42" });

    await t.withIdentity(OWNER).action(api.missions_node.performReviewAction, {
      missionId,
      actionKey: "approve",
    });

    expect(fetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer bearer-token-42" }),
      }),
    );
  });

  it("throws when artifact has only metadata.articleId and no external.id (unmigrated legacy shape)", async () => {
    mockFetchOk();
    const t = convexTest(schema, modules);
    await seedInstance(t);
    const missionId = await seedMission(t, {
      templateId: SEO_TEMPLATE_ID,
      artifactShape: "legacy-article",
      externalId: "art-legacy-888",
    });
    await seedProjectAgent(t, SEO_TEMPLATE_ID);

    await expect(
      t.withIdentity(OWNER).action(api.missions_node.performReviewAction, {
        missionId,
        actionKey: "approve",
      }),
    ).rejects.toThrow(/No external identifier/i);
  });

  it("records a ReviewApproved domain event", async () => {
    mockFetchOk();
    const t = convexTest(schema, modules);
    await seedInstance(t);
    const missionId = await seedMission(t, { templateId: SEO_TEMPLATE_ID });
    await seedProjectAgent(t, SEO_TEMPLATE_ID);

    await t.withIdentity(OWNER).action(api.missions_node.performReviewAction, {
      missionId,
      actionKey: "approve",
    });

    const events = await t.run(async (ctx) =>
      ctx.db.query("events").collect(),
    );
    expect(events.some((e) => e.type === "ReviewApproved")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// SEO publish (approved → done)
// ---------------------------------------------------------------------------

describe("missions_node.performReviewAction — SEO publish", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns { ok: true } and transitions mission to done", async () => {
    mockFetchOk({ indexing: { status: "submitted", provider: "speedyindex", taskId: "task-done-1" } });
    const t = convexTest(schema, modules);
    await seedInstance(t);
    const missionId = await seedMission(t, { templateId: SEO_TEMPLATE_ID, status: "approved" });
    await seedProjectAgent(t, SEO_TEMPLATE_ID);

    const result = await t.withIdentity(OWNER).action(api.missions_node.performReviewAction, {
      missionId,
      actionKey: "publish",
    });

    expect(result).toEqual({ ok: true });

    const updated = await t.run(async (ctx) => ctx.db.get(missionId));
    expect(updated?.status).toBe("done");
  });

  it("calls article-mcp POST /articles/{id}/publish", async () => {
    mockFetchOk();
    const t = convexTest(schema, modules);
    await seedInstance(t);
    const missionId = await seedMission(t, {
      templateId: SEO_TEMPLATE_ID,
      status: "approved",
      externalId: "art-publish-222",
    });
    await seedProjectAgent(t, SEO_TEMPLATE_ID);

    await t.withIdentity(OWNER).action(api.missions_node.performReviewAction, {
      missionId,
      actionKey: "publish",
    });

    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("/articles/art-publish-222/publish"),
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("passes indexing outcome from response to markDone", async () => {
    mockFetchOk({ indexing: { status: "submitted", provider: "speedyindex", taskId: "task-1" } });
    const t = convexTest(schema, modules);
    await seedInstance(t);
    const missionId = await seedMission(t, { templateId: SEO_TEMPLATE_ID, status: "approved" });
    await seedProjectAgent(t, SEO_TEMPLATE_ID);

    await t.withIdentity(OWNER).action(api.missions_node.performReviewAction, {
      missionId,
      actionKey: "publish",
    });

    const updated = await t.run(async (ctx) => ctx.db.get(missionId));
    expect(updated?.indexing).toMatchObject({ status: "submitted" });
  });

  it("records a ReviewPublished domain event", async () => {
    mockFetchOk();
    const t = convexTest(schema, modules);
    await seedInstance(t);
    const missionId = await seedMission(t, { templateId: SEO_TEMPLATE_ID, status: "approved" });
    await seedProjectAgent(t, SEO_TEMPLATE_ID);

    await t.withIdentity(OWNER).action(api.missions_node.performReviewAction, {
      missionId,
      actionKey: "publish",
    });

    const events = await t.run(async (ctx) =>
      ctx.db.query("events").collect(),
    );
    expect(events.some((e) => e.type === "ReviewPublished")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Video approve (to_validate → approved) and publish (approved → done)
// ---------------------------------------------------------------------------

describe("missions_node.performReviewAction — Video approve", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("transitions video mission to approved and calls /validate endpoint", async () => {
    mockFetchOk();
    const t = convexTest(schema, modules);
    await seedInstance(t);
    const missionId = await seedMission(t, {
      templateId: VIDEO_TEMPLATE_ID,
      status: "to_validate",
      externalId: "run-vid-validate-1",
    });
    await seedProjectAgent(t, VIDEO_TEMPLATE_ID);

    const result = await t.withIdentity(OWNER).action(api.missions_node.performReviewAction, {
      missionId,
      actionKey: "approve",
    });

    expect(result).toEqual({ ok: true });

    const updated = await t.run(async (ctx) => ctx.db.get(missionId));
    expect(updated?.status).toBe("approved");

    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("/videos/run-vid-validate-1/validate"),
      expect.objectContaining({ method: "POST" }),
    );
  });
});

describe("missions_node.performReviewAction — Video publish", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("transitions video mission to done and calls /publish endpoint", async () => {
    mockFetchOk();
    const t = convexTest(schema, modules);
    await seedInstance(t);
    const missionId = await seedMission(t, {
      templateId: VIDEO_TEMPLATE_ID,
      status: "approved",
      externalId: "run-vid-publish-1",
    });
    await seedProjectAgent(t, VIDEO_TEMPLATE_ID);

    const result = await t.withIdentity(OWNER).action(api.missions_node.performReviewAction, {
      missionId,
      actionKey: "publish",
    });

    expect(result).toEqual({ ok: true });

    const updated = await t.run(async (ctx) => ctx.db.get(missionId));
    expect(updated?.status).toBe("done");

    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("/videos/run-vid-publish-1/publish"),
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("sends the exact multi-platform publication contract", async () => {
    mockFetchOk();
    const t = convexTest(schema, modules);
    await seedInstance(t);
    const missionId = await seedMission(t, {
      templateId: VIDEO_TEMPLATE_ID,
      status: "approved",
    });
    await seedProjectAgent(t, VIDEO_TEMPLATE_ID);

    await t.withIdentity(OWNER).action(api.missions_node.performReviewAction, {
      missionId,
      actionKey: "publish",
    });

    const [, requestInit] = vi.mocked(fetch).mock.calls[0];
    const body = JSON.parse((requestInit as RequestInit).body as string) as Record<string, unknown>;
    expect(body).toEqual({ platforms: ["tiktok", "instagram"] });
  });

  it("sends both selected platforms under platforms for lym_create_letter_video", async () => {
    mockFetchOk();
    const t = convexTest(schema, modules);
    await seedInstance(t);
    const missionId = await seedMission(t, {
      templateId: VIDEO_TEMPLATE_ID,
      type: "lym_create_letter_video",
      status: "approved",
    });
    await seedProjectAgent(t, VIDEO_TEMPLATE_ID);

    await t.withIdentity(OWNER).action(api.missions_node.performReviewAction, {
      missionId,
      actionKey: "publish",
    });

    const [, requestInit] = vi.mocked(fetch).mock.calls[0];
    const body = JSON.parse((requestInit as RequestInit).body as string) as Record<string, unknown>;
    expect(body).toEqual({ platforms: ["tiktok", "instagram"] });
  });

  it("uses the selected TikTok platform from the mission payload", async () => {
    mockFetchOk();
    const t = convexTest(schema, modules);
    await seedInstance(t);
    const missionId = await seedMission(t, {
      templateId: VIDEO_TEMPLATE_ID,
      type: "lym_create_marketing_video",
      payload: { platforms: ["tiktok"], category: "apology", occasion: "" },
      status: "approved",
      externalId: "run-tiktok-1",
    });
    await seedProjectAgent(t, VIDEO_TEMPLATE_ID);

    await t.withIdentity(OWNER).action(api.missions_node.performReviewAction, {
      missionId,
      actionKey: "publish",
    });

    const [, requestInit] = vi.mocked(fetch).mock.calls[0];
    const body = JSON.parse((requestInit as RequestInit).body as string) as Record<string, unknown>;
    expect(body).toEqual({ platforms: ["tiktok"] });
  });

  it("sends the platform array as platforms when publishing create_chat_mock_video", async () => {
    mockFetchOk();
    const t = convexTest(schema, modules);
    await seedInstance(t);
    const missionId = await seedMission(t, {
      templateId: VIDEO_TEMPLATE_ID,
      type: "create_chat_mock_video",
      payload: {
        platforms: ["instagram"],
        theme: "dialogue",
        turnCount: 8,
        language: "en",
      },
      status: "approved",
      externalId: "run-chat-1",
    });
    await seedProjectAgent(t, VIDEO_TEMPLATE_ID);

    await t.withIdentity(OWNER).action(api.missions_node.performReviewAction, {
      missionId,
      actionKey: "publish",
    });

    const [, requestInit] = vi.mocked(fetch).mock.calls[0];
    const body = JSON.parse((requestInit as RequestInit).body as string) as Record<string, unknown>;
    expect(body).toEqual({ platforms: ["instagram"] });
  });

  it("throws when artifact has only metadata.runId and no external.id (unmigrated legacy shape)", async () => {
    mockFetchOk();
    const t = convexTest(schema, modules);
    await seedInstance(t);
    const missionId = await seedMission(t, {
      templateId: VIDEO_TEMPLATE_ID,
      status: "approved",
      artifactShape: "legacy-run",
      externalId: "run-legacy-vid-1",
    });
    await seedProjectAgent(t, VIDEO_TEMPLATE_ID);

    await expect(
      t.withIdentity(OWNER).action(api.missions_node.performReviewAction, {
        missionId,
        actionKey: "publish",
      }),
    ).rejects.toThrow(/No external identifier/i);
  });
});

// ---------------------------------------------------------------------------
// Validation: invalid action key
// ---------------------------------------------------------------------------

describe("missions_node.performReviewAction — invalid action", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("throws when the action key does not exist on the template", async () => {
    const t = convexTest(schema, modules);
    await seedInstance(t);
    const missionId = await seedMission(t, { templateId: SEO_TEMPLATE_ID });
    await seedProjectAgent(t, SEO_TEMPLATE_ID);

    await expect(
      t.withIdentity(OWNER).action(api.missions_node.performReviewAction, {
        missionId,
        actionKey: "nonexistent-action",
      }),
    ).rejects.toThrow(/not declared by template/);
  });
});

// ---------------------------------------------------------------------------
// Validation: invalid status
// ---------------------------------------------------------------------------

describe("missions_node.performReviewAction — invalid status", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("throws when mission is not in the required status for approve", async () => {
    const t = convexTest(schema, modules);
    await seedInstance(t);
    // Mission is already "approved", but approve requires "to_validate"
    const missionId = await seedMission(t, { templateId: SEO_TEMPLATE_ID, status: "approved" });
    await seedProjectAgent(t, SEO_TEMPLATE_ID);

    await expect(
      t.withIdentity(OWNER).action(api.missions_node.performReviewAction, {
        missionId,
        actionKey: "approve",
      }),
    ).rejects.toThrow(/requires mission in "to_validate" status/);
  });

  it("throws when mission is not in the required status for publish", async () => {
    const t = convexTest(schema, modules);
    await seedInstance(t);
    // Mission is "to_validate", but publish requires "approved"
    const missionId = await seedMission(t, { templateId: SEO_TEMPLATE_ID, status: "to_validate" });
    await seedProjectAgent(t, SEO_TEMPLATE_ID);

    await expect(
      t.withIdentity(OWNER).action(api.missions_node.performReviewAction, {
        missionId,
        actionKey: "publish",
      }),
    ).rejects.toThrow(/requires mission in "approved" status/);
  });
});

// ---------------------------------------------------------------------------
// Validation: missing artifact
// ---------------------------------------------------------------------------

describe("missions_node.performReviewAction — missing artifact", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("throws when mission has no artifact", async () => {
    const t = convexTest(schema, modules);
    await seedInstance(t);
    const missionId = await seedMission(t, {
      templateId: SEO_TEMPLATE_ID,
      artifactShape: "none",
    });
    await seedProjectAgent(t, SEO_TEMPLATE_ID);

    await expect(
      t.withIdentity(OWNER).action(api.missions_node.performReviewAction, {
        missionId,
        actionKey: "approve",
      }),
    ).rejects.toThrow(/No artifact available/);
  });
});

// ---------------------------------------------------------------------------
// Validation: forbidden access (ownership)
// ---------------------------------------------------------------------------

describe("missions_node.performReviewAction — forbidden access", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("throws Forbidden when called by a different user", async () => {
    const t = convexTest(schema, modules);
    await seedInstance(t);
    const missionId = await seedMission(t, { templateId: SEO_TEMPLATE_ID });
    await seedProjectAgent(t, SEO_TEMPLATE_ID);

    await expect(
      t.withIdentity(OTHER).action(api.missions_node.performReviewAction, {
        missionId,
        actionKey: "approve",
      }),
    ).rejects.toThrow(/Forbidden/);
  });

  it("throws Authentication required when called without identity", async () => {
    const t = convexTest(schema, modules);
    await seedInstance(t);
    const missionId = await seedMission(t, { templateId: SEO_TEMPLATE_ID });
    await seedProjectAgent(t, SEO_TEMPLATE_ID);

    await expect(
      t.action(api.missions_node.performReviewAction, {
        missionId,
        actionKey: "approve",
      }),
    ).rejects.toThrow(/Authentication required/);
  });
});

// ---------------------------------------------------------------------------
// Failed HTTP effect: does NOT corrupt Mission state
// ---------------------------------------------------------------------------

describe("missions_node.performReviewAction — failed effect", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("throws a clear error when the effect HTTP call fails (500)", async () => {
    mockFetchError(500, "Internal Server Error");
    const t = convexTest(schema, modules);
    await seedInstance(t);
    const missionId = await seedMission(t, { templateId: SEO_TEMPLATE_ID });
    await seedProjectAgent(t, SEO_TEMPLATE_ID);

    await expect(
      t.withIdentity(OWNER).action(api.missions_node.performReviewAction, {
        missionId,
        actionKey: "approve",
      }),
    ).rejects.toThrow(/Action "approve" effect failed: 500/);
  });

  it("serializes structured upstream error details instead of [object Object]", async () => {
    mockFetchErrorWithBody(502, "Bad Gateway", { details: { reason: "article-mcp unavailable" } });
    const t = convexTest(schema, modules);
    await seedInstance(t);
    const missionId = await seedMission(t, { templateId: SEO_TEMPLATE_ID });
    await seedProjectAgent(t, SEO_TEMPLATE_ID);

    await expect(
      t.withIdentity(OWNER).action(api.missions_node.performReviewAction, {
        missionId,
        actionKey: "approve",
      }),
    ).rejects.toThrow(/502 Bad Gateway — \{"reason":"article-mcp unavailable"\}/);
  });

  it("does NOT change mission status when the effect HTTP call fails", async () => {
    mockFetchError(500);
    const t = convexTest(schema, modules);
    await seedInstance(t);
    const missionId = await seedMission(t, { templateId: SEO_TEMPLATE_ID });
    await seedProjectAgent(t, SEO_TEMPLATE_ID);

    try {
      await t.withIdentity(OWNER).action(api.missions_node.performReviewAction, {
        missionId,
        actionKey: "approve",
      });
    } catch {
      // Expected to throw
    }

    // Mission status must remain to_validate — no state corruption
    const mission = await t.run(async (ctx) => ctx.db.get(missionId));
    expect(mission?.status).toBe("to_validate");
  });

  it("throws a clear error when the effect HTTP call fails (422)", async () => {
    mockFetchError(422, "Unprocessable Entity");
    const t = convexTest(schema, modules);
    await seedInstance(t);
    const missionId = await seedMission(t, {
      templateId: VIDEO_TEMPLATE_ID,
      status: "approved",
    });
    await seedProjectAgent(t, VIDEO_TEMPLATE_ID);

    await expect(
      t.withIdentity(OWNER).action(api.missions_node.performReviewAction, {
        missionId,
        actionKey: "publish",
      }),
    ).rejects.toThrow(/Action "publish" effect failed: 422/);
  });

  it("does NOT change mission status when publish effect fails", async () => {
    mockFetchError(409);
    const t = convexTest(schema, modules);
    await seedInstance(t);
    const missionId = await seedMission(t, {
      templateId: VIDEO_TEMPLATE_ID,
      status: "approved",
    });
    await seedProjectAgent(t, VIDEO_TEMPLATE_ID);

    try {
      await t.withIdentity(OWNER).action(api.missions_node.performReviewAction, {
        missionId,
        actionKey: "publish",
      });
    } catch {
      // Expected to throw
    }

    const mission = await t.run(async (ctx) => ctx.db.get(missionId));
    expect(mission?.status).toBe("approved");
  });
});

// ---------------------------------------------------------------------------
// Validation: required action input
// ---------------------------------------------------------------------------

describe("missions_node.performReviewAction — required input validation", () => {
  const REQUIRED_INPUT_TEMPLATE_ID = "seo-req";

  beforeEach(() => {
    // The fixture Template lives in test/fixtures; serve it from the in-memory registry.
    setTemplateRegistryForTests(
      inMemoryRegistry([INSTANCE_ID], [loadFixtureTemplate(REQUIRED_INPUT_TEMPLATE_ID)]),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("rejects with /missing or empty/ when a required input is omitted", async () => {
    const t = convexTest(schema, modules);
    await seedInstance(t);
    // Seed a mission with the fixture template that requires a "note" input
    const missionId = await t.run(async (ctx) =>
      ctx.db.insert("missions", {
        ownerId: OWNER.subject,
        instanceId: INSTANCE_ID,
        templateId: REQUIRED_INPUT_TEMPLATE_ID,
        type: "create_article",
        payload: {},
        status: "to_validate",
        lastResult: {
          status: "needs_human_review",
          summary: "Ready for review",
          reviewQuestions: [],
          artifact: {
            kind: "markdown",
            external: { service: "article-mcp", id: "art-req-1" },
            metadata: {},
          },
        },
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }),
    );
    await t.run(async (ctx) =>
      ctx.db.insert("projectAgents", {
        instanceId: INSTANCE_ID,
        templateId: REQUIRED_INPUT_TEMPLATE_ID,
        status: "active",
        mcpServerKeys: ["article-mcp"],
        config: { apiKey: "key-req" },
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }),
    );

    // Omit the required "note" input — should reject
    await expect(
      t.withIdentity(OWNER).action(api.missions_node.performReviewAction, {
        missionId,
        actionKey: "approve",
      }),
    ).rejects.toThrow(/missing or empty/);
  });

  it("succeeds when the required input is supplied", async () => {
    mockFetchOk();
    const t = convexTest(schema, modules);
    await seedInstance(t);
    const missionId = await t.run(async (ctx) =>
      ctx.db.insert("missions", {
        ownerId: OWNER.subject,
        instanceId: INSTANCE_ID,
        templateId: REQUIRED_INPUT_TEMPLATE_ID,
        type: "create_article",
        payload: {},
        status: "to_validate",
        lastResult: {
          status: "needs_human_review",
          summary: "Ready for review",
          reviewQuestions: [],
          artifact: {
            kind: "markdown",
            external: { service: "article-mcp", id: "art-req-2" },
            metadata: {},
          },
        },
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }),
    );
    await t.run(async (ctx) =>
      ctx.db.insert("projectAgents", {
        instanceId: INSTANCE_ID,
        templateId: REQUIRED_INPUT_TEMPLATE_ID,
        status: "active",
        mcpServerKeys: ["article-mcp"],
        config: { apiKey: "key-req" },
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }),
    );

    // Supply the required "note" input — should succeed
    const result = await t.withIdentity(OWNER).action(api.missions_node.performReviewAction, {
      missionId,
      actionKey: "approve",
      input: { note: "Looks good" },
    });

    expect(result).toEqual({ ok: true });
    const updated = await t.run(async (ctx) => ctx.db.get(missionId));
    expect(updated?.status).toBe("approved");
  });

  it("rejects with /missing or empty/ when a required input is an empty string", async () => {
    const t = convexTest(schema, modules);
    await seedInstance(t);
    const missionId = await t.run(async (ctx) =>
      ctx.db.insert("missions", {
        ownerId: OWNER.subject,
        instanceId: INSTANCE_ID,
        templateId: REQUIRED_INPUT_TEMPLATE_ID,
        type: "create_article",
        payload: {},
        status: "to_validate",
        lastResult: {
          status: "needs_human_review",
          summary: "Ready for review",
          reviewQuestions: [],
          artifact: {
            kind: "markdown",
            external: { service: "article-mcp", id: "art-req-3" },
            metadata: {},
          },
        },
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }),
    );
    await t.run(async (ctx) =>
      ctx.db.insert("projectAgents", {
        instanceId: INSTANCE_ID,
        templateId: REQUIRED_INPUT_TEMPLATE_ID,
        status: "active",
        mcpServerKeys: ["article-mcp"],
        config: { apiKey: "key-req" },
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }),
    );

    // Supply empty string for required input — should reject
    await expect(
      t.withIdentity(OWNER).action(api.missions_node.performReviewAction, {
        missionId,
        actionKey: "approve",
        input: { note: "   " },
      }),
    ).rejects.toThrow(/missing or empty/);
  });
});

// ---------------------------------------------------------------------------
// Security: path-interpolated identifiers are percent-encoded
// ---------------------------------------------------------------------------

describe("missions_node.performReviewAction — path encoding", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("percent-encodes the external id in the URL path when it contains / and ?", async () => {
    mockFetchOk();
    const t = convexTest(schema, modules);
    await seedInstance(t);
    // SEO approve action path: /articles/{id}/approve — the external id with
    // slashes must be encoded.
    const missionId = await seedMission(t, {
      templateId: SEO_TEMPLATE_ID,
      externalId: "art/path?injection=1",
    });
    await seedProjectAgent(t, SEO_TEMPLATE_ID);

    await t.withIdentity(OWNER).action(api.missions_node.performReviewAction, {
      missionId,
      actionKey: "approve",
    });

    const [url] = vi.mocked(fetch).mock.calls[0];
    expect(url as string).toContain(encodeURIComponent("art/path?injection=1"));
    expect(url as string).not.toContain("art/path?injection=1");
  });
});

// ---------------------------------------------------------------------------
// Generic reject (revision Run)
// ---------------------------------------------------------------------------

describe("missions_node.performReviewAction — reject (SEO)", () => {
  it("creates a revision Run with humanFeedback and sets mission to doing", async () => {
    const t = convexTest(schema, modules);
    await seedInstance(t);
    const missionId = await seedMission(t, { templateId: SEO_TEMPLATE_ID });
    // Reject needs an active projectAgent with an openclawAgentName for dispatchRun
    await t.run(async (ctx) => {
      const now = Date.now();
      await ctx.db.insert("projectAgents", {
        instanceId: INSTANCE_ID,
        templateId: SEO_TEMPLATE_ID,
        status: "active",
        openclawAgentName: "seo-agent",
        mcpServerKeys: ["article-mcp"],
        config: { apiKey: "key-reject" },
        createdAt: now,
        updatedAt: now,
      });
    });

    const feedback = "The article needs a stronger introduction.";
    const result = await t.withIdentity(OWNER).action(api.missions_node.performReviewAction, {
      missionId,
      actionKey: "reject",
      input: { feedback },
    });

    expect(result).toEqual({ ok: true });

    await t.run(async (ctx) => {
      const mission = await ctx.db.get(missionId);
      expect(mission?.status).toBe("doing");

      const runs = await ctx.db
        .query("runs")
        .withIndex("by_mission", (q) => q.eq("missionId", missionId))
        .collect();
      expect(runs).toHaveLength(1);
      expect(runs[0].status).toBe("pending");
      expect(runs[0].humanFeedback).toBe(feedback);
    });
  });

  it("throws when feedback input is blank", async () => {
    const t = convexTest(schema, modules);
    await seedInstance(t);
    const missionId = await seedMission(t, { templateId: SEO_TEMPLATE_ID });
    await t.run(async (ctx) => {
      const now = Date.now();
      await ctx.db.insert("projectAgents", {
        instanceId: INSTANCE_ID,
        templateId: SEO_TEMPLATE_ID,
        status: "active",
        openclawAgentName: "seo-agent",
        mcpServerKeys: ["article-mcp"],
        createdAt: now,
        updatedAt: now,
      });
    });

    await expect(
      t.withIdentity(OWNER).action(api.missions_node.performReviewAction, {
        missionId,
        actionKey: "reject",
        input: { feedback: "   " },
      }),
    ).rejects.toThrow(/missing or empty/i);

    // No Run should have been created
    await t.run(async (ctx) => {
      const runs = await ctx.db
        .query("runs")
        .withIndex("by_mission", (q) => q.eq("missionId", missionId))
        .collect();
      expect(runs).toHaveLength(0);
    });
  });

  it("throws when feedback input is missing entirely", async () => {
    const t = convexTest(schema, modules);
    await seedInstance(t);
    const missionId = await seedMission(t, { templateId: SEO_TEMPLATE_ID });
    await t.run(async (ctx) => {
      const now = Date.now();
      await ctx.db.insert("projectAgents", {
        instanceId: INSTANCE_ID,
        templateId: SEO_TEMPLATE_ID,
        status: "active",
        openclawAgentName: "seo-agent",
        mcpServerKeys: ["article-mcp"],
        createdAt: now,
        updatedAt: now,
      });
    });

    await expect(
      t.withIdentity(OWNER).action(api.missions_node.performReviewAction, {
        missionId,
        actionKey: "reject",
        // no input.feedback provided
      }),
    ).rejects.toThrow(/missing or empty/i);

    await t.run(async (ctx) => {
      const runs = await ctx.db
        .query("runs")
        .withIndex("by_mission", (q) => q.eq("missionId", missionId))
        .collect();
      expect(runs).toHaveLength(0);
    });
  });

  it("throws when mission is not in to_validate status", async () => {
    const t = convexTest(schema, modules);
    await seedInstance(t);
    const missionId = await seedMission(t, {
      templateId: SEO_TEMPLATE_ID,
      status: "approved",
    });
    await t.run(async (ctx) => {
      const now = Date.now();
      await ctx.db.insert("projectAgents", {
        instanceId: INSTANCE_ID,
        templateId: SEO_TEMPLATE_ID,
        status: "active",
        openclawAgentName: "seo-agent",
        mcpServerKeys: ["article-mcp"],
        createdAt: now,
        updatedAt: now,
      });
    });

    await expect(
      t.withIdentity(OWNER).action(api.missions_node.performReviewAction, {
        missionId,
        actionKey: "reject",
        input: { feedback: "Needs work." },
      }),
    ).rejects.toThrow(/to_validate/i);
  });

  it("throws Forbidden when a different user tries to reject", async () => {
    const t = convexTest(schema, modules);
    await seedInstance(t);
    const missionId = await seedMission(t, { templateId: SEO_TEMPLATE_ID });
    await t.run(async (ctx) => {
      const now = Date.now();
      await ctx.db.insert("projectAgents", {
        instanceId: INSTANCE_ID,
        templateId: SEO_TEMPLATE_ID,
        status: "active",
        openclawAgentName: "seo-agent",
        mcpServerKeys: ["article-mcp"],
        createdAt: now,
        updatedAt: now,
      });
    });

    await expect(
      t.withIdentity(OTHER).action(api.missions_node.performReviewAction, {
        missionId,
        actionKey: "reject",
        input: { feedback: "Not good enough." },
      }),
    ).rejects.toThrow(/Forbidden/i);

    // Mission remains in to_validate
    await t.run(async (ctx) => {
      const mission = await ctx.db.get(missionId);
      expect(mission?.status).toBe("to_validate");
    });
  });

  it("records a ReviewRejected event with the feedback text", async () => {
    const t = convexTest(schema, modules);
    await seedInstance(t);
    const missionId = await seedMission(t, { templateId: SEO_TEMPLATE_ID });
    await t.run(async (ctx) => {
      const now = Date.now();
      await ctx.db.insert("projectAgents", {
        instanceId: INSTANCE_ID,
        templateId: SEO_TEMPLATE_ID,
        status: "active",
        openclawAgentName: "seo-agent",
        mcpServerKeys: ["article-mcp"],
        createdAt: now,
        updatedAt: now,
      });
    });

    const feedback = "Improve the call-to-action.";
    await t.withIdentity(OWNER).action(api.missions_node.performReviewAction, {
      missionId,
      actionKey: "reject",
      input: { feedback },
    });

    await t.run(async (ctx) => {
      const events = await ctx.db
        .query("events")
        .withIndex("by_instance_created", (q) => q.eq("instanceId", INSTANCE_ID))
        .collect();
      const rejected = events.find((e) => e.type === "ReviewRejected");
      expect(rejected).toBeTruthy();
      expect((rejected?.payload as Record<string, unknown>)?.feedback).toBe(feedback);
      expect((rejected?.payload as Record<string, unknown>)?.missionId).toBe(missionId);
    });
  });

  it("makes no HTTP/fetch call (revision_run is a pure mutation path)", async () => {
    // Reject does not call any external service — no fetch stub needed.
    // This test verifies the happy path completes without fetch being called.
    const fetchSpy = vi.spyOn(global, "fetch");
    const t = convexTest(schema, modules);
    await seedInstance(t);
    const missionId = await seedMission(t, { templateId: SEO_TEMPLATE_ID });
    await t.run(async (ctx) => {
      const now = Date.now();
      await ctx.db.insert("projectAgents", {
        instanceId: INSTANCE_ID,
        templateId: SEO_TEMPLATE_ID,
        status: "active",
        openclawAgentName: "seo-agent",
        mcpServerKeys: ["article-mcp"],
        createdAt: now,
        updatedAt: now,
      });
    });

    await t.withIdentity(OWNER).action(api.missions_node.performReviewAction, {
      missionId,
      actionKey: "reject",
      input: { feedback: "Improve the tone." },
    });

    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// internal_linking: approve (pure transition) and publish (merge)
// ---------------------------------------------------------------------------

describe("missions_node.performReviewAction — internal_linking approve (Validate)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function seedInternalLinkingMission(
    t: ReturnType<typeof convexTest>,
    opts: { status?: "to_validate" | "approved"; jobId?: string } = {},
  ) {
    const { status = "to_validate", jobId = "job-link-pra-1" } = opts;
    const now = Date.now();
    return t.run(async (ctx) => {
      return ctx.db.insert("missions", {
        ownerId: OWNER.subject,
        instanceId: INSTANCE_ID,
        templateId: SEO_TEMPLATE_ID,
        type: "internal_linking",
        payload: {},
        status,
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

  it("transitions mission to approved without making any HTTP call", async () => {
    const fetchSpy = vi.spyOn(global, "fetch");
    const t = convexTest(schema, modules);
    await seedInstance(t);
    const missionId = await seedInternalLinkingMission(t);
    await seedProjectAgent(t, SEO_TEMPLATE_ID);

    const result = await t.withIdentity(OWNER).action(api.missions_node.performReviewAction, {
      missionId,
      actionKey: "approve",
    });

    expect(result).toEqual({ ok: true });
    const updated = await t.run(async (ctx) => ctx.db.get(missionId));
    expect(updated?.status).toBe("approved");
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("calls POST /linking-jobs/{id}/merge (not /articles/{id}/merge) on publish", async () => {
    mockFetchOk();
    const t = convexTest(schema, modules);
    await seedInstance(t);
    const missionId = await seedInternalLinkingMission(t, {
      status: "approved",
      jobId: "job-link-merge-1",
    });
    await seedProjectAgent(t, SEO_TEMPLATE_ID);

    const result = await t.withIdentity(OWNER).action(api.missions_node.performReviewAction, {
      missionId,
      actionKey: "publish",
    });

    expect(result).toEqual({ ok: true });
    const updated = await t.run(async (ctx) => ctx.db.get(missionId));
    expect(updated?.status).toBe("done");
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("/linking-jobs/job-link-merge-1/merge"),
      expect.objectContaining({ method: "POST" }),
    );
    expect(fetch).not.toHaveBeenCalledWith(
      expect.stringContaining("/articles/"),
      expect.anything(),
    );
  });
});

describe("missions_node.performReviewAction — reject (video)", () => {
  it("creates a revision Run with humanFeedback and sets mission to doing (video)", async () => {
    const t = convexTest(schema, modules);
    await seedInstance(t);
    const missionId = await seedMission(t, { templateId: VIDEO_TEMPLATE_ID });
    await t.run(async (ctx) => {
      const now = Date.now();
      await ctx.db.insert("projectAgents", {
        instanceId: INSTANCE_ID,
        templateId: VIDEO_TEMPLATE_ID,
        status: "active",
        openclawAgentName: "video-agent",
        mcpServerKeys: ["video-mcp"],
        config: { apiKey: "key-reject-video" },
        createdAt: now,
        updatedAt: now,
      });
    });

    const feedback = "The pacing is too fast, please slow it down.";
    const result = await t.withIdentity(OWNER).action(api.missions_node.performReviewAction, {
      missionId,
      actionKey: "reject",
      input: { feedback },
    });

    expect(result).toEqual({ ok: true });

    await t.run(async (ctx) => {
      const mission = await ctx.db.get(missionId);
      expect(mission?.status).toBe("doing");

      const runs = await ctx.db
        .query("runs")
        .withIndex("by_mission", (q) => q.eq("missionId", missionId))
        .collect();
      expect(runs).toHaveLength(1);
      expect(runs[0].status).toBe("pending");
      expect(runs[0].humanFeedback).toBe(feedback);
    });
  });

  it("records a ReviewRejected event for video missions", async () => {
    const t = convexTest(schema, modules);
    await seedInstance(t);
    const missionId = await seedMission(t, { templateId: VIDEO_TEMPLATE_ID });
    await t.run(async (ctx) => {
      const now = Date.now();
      await ctx.db.insert("projectAgents", {
        instanceId: INSTANCE_ID,
        templateId: VIDEO_TEMPLATE_ID,
        status: "active",
        openclawAgentName: "video-agent",
        mcpServerKeys: ["video-mcp"],
        createdAt: now,
        updatedAt: now,
      });
    });

    const feedback = "Wrong background music.";
    await t.withIdentity(OWNER).action(api.missions_node.performReviewAction, {
      missionId,
      actionKey: "reject",
      input: { feedback },
    });

    await t.run(async (ctx) => {
      const events = await ctx.db
        .query("events")
        .withIndex("by_instance_created", (q) => q.eq("instanceId", INSTANCE_ID))
        .collect();
      const rejected = events.find((e) => e.type === "ReviewRejected");
      expect(rejected).toBeTruthy();
      expect((rejected?.payload as Record<string, unknown>)?.feedback).toBe(feedback);
    });
  });
});
