import { insertInstance } from "./instance_fixture";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { join } from "node:path";
import { convexTest } from "convex-test";
import { api } from "../_generated/api";
import schema from "../schema";

import { installTemplateRegistry, loadFixtureTemplate } from "./helpers/template_registry.helpers";

let restoreRegistry: () => void;

const modules = {
  "../_generated/api.ts": () => import("../_generated/api.js"),
  "../sources.ts": () => import("../sources.js"),
};

const INSTANCE_ID = "instance-src";
const OWNER = { name: "Owner", email: "o@example.com", tokenIdentifier: "test|owner-src", subject: "owner-src" };
const STRANGER = { name: "S", email: "s@example.com", tokenIdentifier: "test|stranger-src", subject: "stranger-src" };
const TEMPLATE_ID = "sources-fixture";

beforeEach(() => {
  restoreRegistry = installTemplateRegistry([INSTANCE_ID], [loadFixtureTemplate(TEMPLATE_ID)]);
});
afterEach(() => {
  restoreRegistry();
});

async function seed(t: ReturnType<typeof convexTest>, rows: Array<Record<string, unknown>>) {
  return await t.run(async (ctx) => {
    const now = new Date().toISOString();
    await insertInstance(ctx, {
      jobId: "job-src",
      status: "running",
      createdAt: now,
      openclawId: INSTANCE_ID,
      updatedAt: now,
      userId: OWNER.subject,
    });
    const ids = [];
    for (const [i, row] of rows.entries()) {
      ids.push(
        await ctx.db.insert("sources", {
          instanceId: INSTANCE_ID,
          ownerId: OWNER.subject,
          templateId: TEMPLATE_ID,
          sourceId: "keyword",
          label: "Keyword",
          family: "search",
          status: "ready",
          origin: "https://example.com",
          capturedAt: 1000 + i,
          createdAt: 1000 + i,
          marketing: {},
          analysis: { query: "x" },
          ...row,
        } as never),
      );
    }
    return ids;
  });
}

const FIRST_PAGE = { numItems: 50, cursor: null };

describe("sources.listByInstance", () => {
  it("lists the owner's Sources most-recently-captured first", async () => {
    const t = convexTest(schema, modules);
    await seed(t, [{ origin: "old" }, { origin: "new" }]);
    const result = await t
      .withIdentity(OWNER)
      .query(api.sources.listByInstance, { instanceId: INSTANCE_ID, paginationOpts: FIRST_PAGE });
    expect(result.page.map((r) => r.origin)).toEqual(["new", "old"]);
    expect(result.isDone).toBe(true);
  });

  it("leaves another owner's Sources out of the page", async () => {
    const t = convexTest(schema, modules);
    await seed(t, [{ origin: "mine" }, { origin: "theirs", ownerId: STRANGER.subject }]);
    const result = await t
      .withIdentity(OWNER)
      .query(api.sources.listByInstance, { instanceId: INSTANCE_ID, paginationOpts: FIRST_PAGE });
    expect(result.page.map((r) => r.origin)).toEqual(["mine"]);
  });

  it("returns an empty finished page for a stranger", async () => {
    const t = convexTest(schema, modules);
    await seed(t, [{}]);
    const result = await t
      .withIdentity(STRANGER)
      .query(api.sources.listByInstance, { instanceId: INSTANCE_ID, paginationOpts: FIRST_PAGE });
    expect(result.page).toEqual([]);
    expect(result.isDone).toBe(true);
  });

  it("pages through more than one page with a cursor, without repeats", async () => {
    const t = convexTest(schema, modules);
    await seed(t, Array.from({ length: 5 }, (_, i) => ({ origin: `o${i}` })));
    const first = await t
      .withIdentity(OWNER)
      .query(api.sources.listByInstance, { instanceId: INSTANCE_ID, paginationOpts: { numItems: 2, cursor: null } });
    expect(first.page.map((r) => r.origin)).toEqual(["o4", "o3"]);
    expect(first.isDone).toBe(false);
    const second = await t.withIdentity(OWNER).query(api.sources.listByInstance, {
      instanceId: INSTANCE_ID,
      paginationOpts: { numItems: 2, cursor: first.continueCursor },
    });
    expect(second.page.map((r) => r.origin)).toEqual(["o2", "o1"]);
    const third = await t.withIdentity(OWNER).query(api.sources.listByInstance, {
      instanceId: INSTANCE_ID,
      paginationOpts: { numItems: 2, cursor: second.continueCursor },
    });
    expect(third.page.map((r) => r.origin)).toEqual(["o0"]);
    expect(third.isDone).toBe(true);
  });

  it("filters by family in the index, keeping ownership scoping", async () => {
    const t = convexTest(schema, modules);
    await seed(t, [
      { origin: "kw1", family: "search" },
      { origin: "reel1", family: "social-video" },
      { origin: "kw2", family: "search" },
      { origin: "theirs", family: "search", ownerId: STRANGER.subject },
    ]);
    const result = await t.withIdentity(OWNER).query(api.sources.listByInstance, {
      instanceId: INSTANCE_ID,
      family: "search",
      paginationOpts: FIRST_PAGE,
    });
    expect(result.page.map((r) => r.origin)).toEqual(["kw2", "kw1"]);
  });
});

describe("sources.listFamilies", () => {
  it("lists the distinct families of the owner's Sources, sorted", async () => {
    const t = convexTest(schema, modules);
    await seed(t, [
      { family: "social-video" },
      { family: "search" },
      { family: "search" },
      { family: "zzz-theirs", ownerId: STRANGER.subject },
    ]);
    expect(await t.withIdentity(OWNER).query(api.sources.listFamilies, { instanceId: INSTANCE_ID })).toEqual([
      "search",
      "social-video",
    ]);
  });

  it("returns nothing for a stranger", async () => {
    const t = convexTest(schema, modules);
    await seed(t, [{}]);
    expect(await t.withIdentity(STRANGER).query(api.sources.listFamilies, { instanceId: INSTANCE_ID })).toEqual([]);
  });
});

describe("sources.get", () => {
  it("returns the Source with its declared analysis schema", async () => {
    const t = convexTest(schema, modules);
    const [id] = await seed(t, [{}]);
    const result = await t.withIdentity(OWNER).query(api.sources.get, { sourceId: id as never });
    expect(result?.source.origin).toBe("https://example.com");
    expect(result?.analysisSchema).toMatchObject({ type: "object" });
  });

  it("returns a null schema when the Template no longer declares the Source", async () => {
    const t = convexTest(schema, modules);
    const [id] = await seed(t, [{ sourceId: "gone" }]);
    const result = await t.withIdentity(OWNER).query(api.sources.get, { sourceId: id as never });
    expect(result?.analysisSchema).toBeNull();
  });

  it("returns the Agent's workspaceKey (for the Run link), null when the Agent is gone", async () => {
    const t = convexTest(schema, modules);
    const [id] = await seed(t, [{}]);
    expect((await t.withIdentity(OWNER).query(api.sources.get, { sourceId: id as never }))?.workspaceKey).toBeNull();
    await t.run((ctx) =>
      ctx.db.insert("projectAgents", {
        instanceId: INSTANCE_ID, templateId: TEMPLATE_ID, status: "active", workspaceKey: "ws-1",
        mcpServerKeys: [], createdAt: 1, updatedAt: 1,
      }),
    );
    expect((await t.withIdentity(OWNER).query(api.sources.get, { sourceId: id as never }))?.workspaceKey).toBe("ws-1");
  });

  it("returns null for a stranger", async () => {
    const t = convexTest(schema, modules);
    const [id] = await seed(t, [{}]);
    expect(await t.withIdentity(STRANGER).query(api.sources.get, { sourceId: id as never })).toBeNull();
  });
});

describe("sources.retry", () => {
  it("puts a failed Source back to processing", async () => {
    const t = convexTest(schema, modules);
    const [id] = await seed(t, [{ status: "failed" }]);
    await t.withIdentity(OWNER).mutation(api.sources.retry, { sourceId: id as never });
    const row = await t.run((ctx) => ctx.db.get(id as never));
    expect((row as { status: string }).status).toBe("processing");
  });

  it.each(["unavailable", "ready", "processing"])("refuses a %s Source", async (status) => {
    const t = convexTest(schema, modules);
    const [id] = await seed(t, [{ status }]);
    await expect(t.withIdentity(OWNER).mutation(api.sources.retry, { sourceId: id as never })).rejects.toThrow(
      "Only a failed Source can be retried",
    );
  });

  it("refuses a stranger", async () => {
    const t = convexTest(schema, modules);
    const [id] = await seed(t, [{ status: "failed" }]);
    await expect(t.withIdentity(STRANGER).mutation(api.sources.retry, { sourceId: id as never })).rejects.toThrow(
      "Forbidden",
    );
  });
});
