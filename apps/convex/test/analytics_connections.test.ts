import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import { api } from "../_generated/api";
import schema from "../schema";
import { insertInstance } from "./instance_fixture";
import { installAnalyticsAdapter, POSTIZ_ANALYTICS } from "./analytics_fixture";

// ADR-078, issue #93: the connection and the options of an Analytics Adapter are
// configured once per Project, like a Publisher's (publishers.save / list).

const modules = {
  "../_generated/api.ts": () => import("../_generated/api.js"),
  "../analytics_adapters.ts": () => import("../analytics_adapters.js"),
  "../analytics_connections.ts": () => import("../analytics_connections.js"),
};
const INSTANCE_ID = "openclaw-conn";
const OWNER = { name: "Owner", email: "o@e.com", tokenIdentifier: "test|conn", subject: "conn-owner" };
const POSTIZ = {
  ...POSTIZ_ANALYTICS,
  earliestDelayMs: 0,
  options: [{ key: "lookbackDays", label: "Look-back window (days)", type: "number" as const, default: 7, min: 1, max: 90 }],
};

async function seed() {
  const t = convexTest(schema, modules);
  await installAnalyticsAdapter(t, POSTIZ);
  await t.run(async (ctx) => {
    const now = new Date().toISOString();
    await insertInstance(ctx, { jobId: `job-${INSTANCE_ID}`, status: "running", createdAt: now, openclawId: INSTANCE_ID, updatedAt: now, userId: OWNER.tokenIdentifier });
  });
  return t.withIdentity(OWNER);
}

describe("Analytics Adapter connection per Project", () => {
  it("lists the installed adapters with their options, unconfigured at first", async () => {
    const owner = await seed();
    expect(await owner.query(api.analytics_connections.list, { instanceId: INSTANCE_ID })).toEqual([
      {
        adapter: "postiz-analytics",
        name: "Postiz analytics",
        publisher: "postiz",
        optionDecls: POSTIZ.options,
        configured: false,
      },
    ]);
  });

  it("saves a connection and options, never returning the API key", async () => {
    const owner = await seed();
    await owner.mutation(api.analytics_connections.save, {
      instanceId: INSTANCE_ID,
      adapter: "postiz-analytics",
      url: "https://postiz.example.com/",
      apiKey: "secret",
      options: { lookbackDays: 30 },
    });
    const [view] = await owner.query(api.analytics_connections.list, { instanceId: INSTANCE_ID });
    expect(view).toMatchObject({ configured: true, url: "https://postiz.example.com", hasApiKey: true, options: { lookbackDays: 30 } });
    expect(JSON.stringify(view)).not.toContain("secret");
  });

  it("keeps the stored key when saved again without one", async () => {
    const owner = await seed();
    const base = { instanceId: INSTANCE_ID, adapter: "postiz-analytics", url: "https://postiz.example.com" };
    await owner.mutation(api.analytics_connections.save, { ...base, apiKey: "secret" });
    await owner.mutation(api.analytics_connections.save, { ...base, url: "https://other.example.com" });
    const [view] = await owner.query(api.analytics_connections.list, { instanceId: INSTANCE_ID });
    expect(view).toMatchObject({ url: "https://other.example.com", hasApiKey: true });
  });

  it("refuses an adapter that is not installed, a bad URL and options the package does not declare", async () => {
    const owner = await seed();
    const base = { instanceId: INSTANCE_ID, adapter: "postiz-analytics", url: "https://postiz.example.com", apiKey: "k" };
    await expect(owner.mutation(api.analytics_connections.save, { ...base, adapter: "nope" })).rejects.toThrow(/not installed/);
    await expect(owner.mutation(api.analytics_connections.save, { ...base, url: "ftp://x" })).rejects.toThrow(/Invalid URL/);
    await expect(owner.mutation(api.analytics_connections.save, { ...base, options: { lookbackDays: 500 } })).rejects.toThrow(/lookbackDays/);
    await expect(owner.mutation(api.analytics_connections.save, { ...base, options: { other: 1 } })).rejects.toThrow(/other/);
  });

  it("removes a connection", async () => {
    const owner = await seed();
    await owner.mutation(api.analytics_connections.save, { instanceId: INSTANCE_ID, adapter: "postiz-analytics", url: "https://p.example.com", apiKey: "k" });
    await owner.mutation(api.analytics_connections.remove, { instanceId: INSTANCE_ID, adapter: "postiz-analytics" });
    const [view] = await owner.query(api.analytics_connections.list, { instanceId: INSTANCE_ID });
    expect(view).toMatchObject({ configured: false });
  });

  it("does not show another user's Project", async () => {
    const owner = await seed();
    expect(await owner.query(api.analytics_connections.list, { instanceId: "someone-else" })).toEqual([]);
  });

  describe("an adapter of contract 2 that declares its secret and no URL (ADR-079)", () => {
    const SC = {
      id: "search-console",
      name: "Search Console",
      needs: "url" as const,
      earliestDelayMs: 0,
      needsUrl: false,
      secret: { label: "Service account key", kind: "json" as const, fields: ["client_email", "private_key"] },
      primary: "clicks",
      metrics: [{ key: "clicks", label: "Clicks", type: "counter" as const, format: "number" as const }],
    };
    const KEY = JSON.stringify({ client_email: "a@b.iam", private_key: "-----BEGIN-----\nx" });

    it("lists what the connection needs, and saves a connection with no URL", async () => {
      const t = convexTest(schema, modules);
      await installAnalyticsAdapter(t, SC);
      await t.run(async (ctx) => {
        const now = new Date().toISOString();
        await insertInstance(ctx, { jobId: `job-${INSTANCE_ID}`, status: "running", createdAt: now, openclawId: INSTANCE_ID, updatedAt: now, userId: OWNER.tokenIdentifier });
      });
      const owner = t.withIdentity(OWNER);
      const [before] = await owner.query(api.analytics_connections.list, { instanceId: INSTANCE_ID });
      expect(before).toMatchObject({ needsUrl: false, secret: SC.secret });
      await owner.mutation(api.analytics_connections.save, { instanceId: INSTANCE_ID, adapter: "search-console", apiKey: KEY });
      const [view] = await owner.query(api.analytics_connections.list, { instanceId: INSTANCE_ID });
      expect(view).toMatchObject({ configured: true, hasApiKey: true });
      expect(JSON.stringify(view)).not.toContain("BEGIN");
      // The stored secret is what the adapter reads with.
      const stored = await t.run((ctx) => ctx.db.query("analyticsConnections").first());
      expect(stored).toMatchObject({ adapter: "search-console", apiKey: KEY });
    });

    it("refuses a secret that is not JSON with the fields the adapter names, saving nothing", async () => {
      const t = convexTest(schema, modules);
      await installAnalyticsAdapter(t, SC);
      await t.run(async (ctx) => {
        const now = new Date().toISOString();
        await insertInstance(ctx, { jobId: `job-${INSTANCE_ID}`, status: "running", createdAt: now, openclawId: INSTANCE_ID, updatedAt: now, userId: OWNER.tokenIdentifier });
      });
      const owner = t.withIdentity(OWNER);
      const save = (apiKey: string) => owner.mutation(api.analytics_connections.save, { instanceId: INSTANCE_ID, adapter: "search-console", apiKey });
      await expect(save("just a line")).rejects.toThrow(/not valid JSON/);
      await expect(save(JSON.stringify({ client_email: "a@b" }))).rejects.toThrow(/private_key/);
      expect(await t.run((ctx) => ctx.db.query("analyticsConnections").collect())).toEqual([]);
    });
  });
});
