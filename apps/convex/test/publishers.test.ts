import { afterEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import { api } from "../_generated/api";
import schema from "../schema";
import { installPostiz } from "./postiz_fixture";
import { insertInstance } from "./instance_fixture";

vi.mock("../publisher/load_node.js", async () => (await import("./postiz_fixture")).postizLoaderModule);

const modules = {
  "../_generated/api.ts": () => import("../_generated/api.js"),
  "../publishers.ts": () => import("../publishers.js"),
  "../publishers_node.ts": () => import("../publishers_node.js"),
};

const INSTANCE_ID = "openclaw-publishers";
const OWNER = { name: "Owner", email: "o@example.com", tokenIdentifier: "test|pub-owner", subject: "pub-owner" };
const STRANGER = { name: "S", email: "s@example.com", tokenIdentifier: "test|pub-stranger", subject: "pub-stranger" };

async function seed() {
  const t = convexTest(schema, modules);
  await installPostiz(t);
  await t.run(async (ctx) => {
    const now = new Date().toISOString();
    await insertInstance(ctx, {
      jobId: `job-${INSTANCE_ID}`,
      status: "running",
      createdAt: now,
      openclawId: INSTANCE_ID,
      updatedAt: now,
      userId: OWNER.subject,
    });
  });
  return t;
}

function stubFetch(handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const fn = vi.fn(async (url: unknown, init?: RequestInit) => handler(String(url), init ?? {}));
  vi.stubGlobal("fetch", fn);
  return fn;
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const CONNECTION = {
  instanceId: INSTANCE_ID,
  adapter: "postiz" as const,
  url: "https://postiz.example.com/api/",
  apiKey: "secret-key",
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("publishers", () => {
  it("refuses a Publisher whose package is not installed", async () => {
    const t = await seed();
    await expect(
      t.withIdentity(OWNER).mutation(api.publishers.save, { instanceId: INSTANCE_ID, adapter: "unknown", url: "https://p.example.com", apiKey: "k" }),
    ).rejects.toThrow('The Publisher "unknown" is not installed');
  });

  it("has no Publisher until configured, and never returns the API key", async () => {
    const t = await seed();
    const owner = t.withIdentity(OWNER);
    await expect(owner.query(api.publishers.get, { instanceId: INSTANCE_ID })).resolves.toBeNull();

    await owner.mutation(api.publishers.save, CONNECTION);
    const publisher = await owner.query(api.publishers.get, { instanceId: INSTANCE_ID });
    expect(publisher).toMatchObject({
      adapter: "postiz",
      url: "https://postiz.example.com/api",
      hasApiKey: true,
      targets: [],
    });
    expect(JSON.stringify(publisher)).not.toContain("secret-key");
  });

  it("keeps the stored API key when saved again without one (one Publisher per Project)", async () => {
    const t = await seed();
    const owner = t.withIdentity(OWNER);
    await owner.mutation(api.publishers.save, CONNECTION);
    await owner.mutation(api.publishers.save, {
      instanceId: INSTANCE_ID,
      adapter: "postiz",
      url: "https://other.example.com",
    });
    const fetchMock = stubFetch(() => json({ connected: true }));
    await owner.action(api.publishers_node.testConnection, { instanceId: INSTANCE_ID });
    expect(fetchMock.mock.calls).toHaveLength(1);
    expect(fetchMock.mock.calls[0][0]).toBe("https://other.example.com/api/public/v1/is-connected");
    expect((fetchMock.mock.calls[0][1] as RequestInit).headers).toMatchObject({ Authorization: "secret-key" });
  });

  it("refuses other users", async () => {
    const t = await seed();
    await t.withIdentity(OWNER).mutation(api.publishers.save, CONNECTION);
    await expect(t.withIdentity(STRANGER).mutation(api.publishers.save, CONNECTION)).rejects.toThrow("Forbidden");
    await expect(
      t.withIdentity(STRANGER).action(api.publishers_node.listChannels, { instanceId: INSTANCE_ID }),
    ).rejects.toThrow("Forbidden");
  });

  it("test connection reports success or a clear error", async () => {
    const t = await seed();
    const owner = t.withIdentity(OWNER);
    await expect(owner.action(api.publishers_node.testConnection, { instanceId: INSTANCE_ID })).resolves.toEqual({
      ok: false,
      error: "No Publisher configured",
    });
    await owner.mutation(api.publishers.save, CONNECTION);

    stubFetch(() => json({ connected: true }));
    await expect(owner.action(api.publishers_node.testConnection, { instanceId: INSTANCE_ID })).resolves.toEqual({
      ok: true,
    });

    stubFetch(() => new Response("nope", { status: 401 }));
    const bad = await owner.action(api.publishers_node.testConnection, { instanceId: INSTANCE_ID });
    expect(bad).toMatchObject({ ok: false, error: expect.stringContaining("401") });

    stubFetch(() => {
      throw new Error("getaddrinfo ENOTFOUND");
    });
    const down = await owner.action(api.publishers_node.testConnection, { instanceId: INSTANCE_ID });
    expect(down).toMatchObject({ ok: false, error: expect.stringContaining("ENOTFOUND") });
  });

  it("calls Postiz at exactly <host>/api/public/v1/... when the URL was saved with trailing slashes", async () => {
    const t = await seed();
    const owner = t.withIdentity(OWNER);
    await owner.mutation(api.publishers.save, { ...CONNECTION, url: "https://postiz.example.com///" });
    const fetchMock = stubFetch(() => json({ connected: true }));
    await owner.action(api.publishers_node.testConnection, { instanceId: INSTANCE_ID });
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual(["https://postiz.example.com/api/public/v1/is-connected"]);
  });

  it("lists the real channels of the Postiz account", async () => {
    const t = await seed();
    const owner = t.withIdentity(OWNER);
    await owner.mutation(api.publishers.save, CONNECTION);
    stubFetch(() =>
      json([
        { id: "c1", name: "My Insta", identifier: "instagram", picture: "https://img/1.png", disabled: false },
        { id: "c2", name: "Pins", identifier: "pinterest", disabled: true },
      ]),
    );
    await expect(owner.action(api.publishers_node.listChannels, { instanceId: INSTANCE_ID })).resolves.toEqual({
      ok: true,
      channels: [
        { id: "c1", name: "My Insta", service: "instagram", picture: "https://img/1.png", disabled: false },
        { id: "c2", name: "Pins", service: "pinterest", disabled: true },
      ],
    });
  });

  it("adds channels under generated keys, stores their profile, edits settings and removes them", async () => {
    const t = await seed();
    const owner = t.withIdentity(OWNER);
    await owner.mutation(api.publishers.save, CONNECTION);

    const insta = await owner.mutation(api.publishers.addChannel, {
      instanceId: INSTANCE_ID,
      channelId: "c1",
      channelName: "My Insta",
      channelService: "instagram",
      channelProfile: "myinsta",
    });
    const second = await owner.mutation(api.publishers.addChannel, {
      instanceId: INSTANCE_ID,
      channelId: "c2",
      channelName: "Other Insta",
      channelService: "instagram",
      channelProfile: "Other.Insta",
      settings: { board: "b" },
    });
    expect(insta).toBe("instagram:myinsta");
    expect(second).toBe("instagram:other-insta");
    // Adding the same channel again is idempotent.
    await expect(
      owner.mutation(api.publishers.addChannel, {
        instanceId: INSTANCE_ID,
        channelId: "c1",
        channelName: "My Insta",
        channelService: "instagram",
      }),
    ).resolves.toBe("instagram:myinsta");

    await owner.mutation(api.publishers.updateSettings, { instanceId: INSTANCE_ID, target: second, settings: { board: "recipes" } });
    let publisher = await owner.query(api.publishers.get, { instanceId: INSTANCE_ID });
    expect(publisher?.targets).toEqual([
      { target: "instagram:myinsta", mapped: true, channelId: "c1", channelName: "My Insta", channelService: "instagram", channelProfile: "myinsta" },
      {
        target: "instagram:other-insta",
        mapped: true,
        channelId: "c2",
        channelName: "Other Insta",
        channelService: "instagram",
        channelProfile: "Other.Insta",
        settings: { board: "recipes" },
      },
    ]);

    await owner.mutation(api.publishers.removeTarget, { instanceId: INSTANCE_ID, target: "instagram:myinsta" });
    publisher = await owner.query(api.publishers.get, { instanceId: INSTANCE_ID });
    expect(publisher?.targets.map((x) => x.target)).toEqual(["instagram:other-insta"]);
  });

  it("stores the handles of channels added without one, in one write, once, without changing their keys", async () => {
    const t = await seed();
    const owner = t.withIdentity(OWNER);
    await owner.mutation(api.publishers.save, CONNECTION);
    await t.run(async (ctx) => {
      const publisher = await ctx.db.query("publishers").first();
      await ctx.db.patch(publisher!._id, {
        targets: [
          { target: "instagram", channelId: "c1", channelName: "Love You Make", channelService: "instagram" },
          { target: "tiktok", channelId: "c2", channelName: "Loveyoumake", channelService: "tiktok", channelProfile: "kept" },
        ],
      });
    });
    await owner.mutation(api.publishers.setChannelProfiles, {
      instanceId: INSTANCE_ID,
      profiles: [
        { target: "instagram", channelProfile: "love_youmake" },
        // A stored handle is never overwritten, and a channel that is gone is skipped.
        { target: "tiktok", channelProfile: "other" },
        { target: "nope", channelProfile: "x" },
      ],
    });
    const publisher = await owner.query(api.publishers.get, { instanceId: INSTANCE_ID });
    expect(publisher?.targets).toMatchObject([
      { target: "instagram", channelProfile: "love_youmake" },
      { target: "tiktok", channelProfile: "kept" },
    ]);
  });

  it("always generates `<platform>:<handle>` keys and refuses missing or duplicate handles", async () => {
    const t = await seed();
    const owner = t.withIdentity(OWNER);
    await owner.mutation(api.publishers.save, CONNECTION);
    const add = (channelId: string, channelName: string, channelService: string, channelProfile?: string) =>
      owner.mutation(api.publishers.addChannel, { instanceId: INSTANCE_ID, channelId, channelName, channelService, channelProfile });

    expect(await add("c1", "My IG", "instagram", "love_youmake")).toBe("instagram:love_youmake");
    // Adding the same channel twice returns the same key.
    expect(await add("c1", "My IG", "instagram", "love_youmake")).toBe("instagram:love_youmake");
    await expect(add("c2", "My Pins", "pinterest")).rejects.toThrow("This channel has no handle, so it cannot be added");
    await expect(add("c2", "My Pins", "pinterest", "")).rejects.toThrow("no handle");
    await expect(add("c3", "Other", "instagram", "Love_YouMake")).rejects.toThrow("A channel with this handle is already added");
    const publisher = await owner.query(api.publishers.get, { instanceId: INSTANCE_ID });
    expect(publisher?.targets.map((x) => x.target)).toEqual(["instagram:love_youmake"]);
  });

  it("slugs a handle with uppercase or special characters into a valid key", async () => {
    const t = await seed();
    const owner = t.withIdentity(OWNER);
    await owner.mutation(api.publishers.save, CONNECTION);
    const key = await owner.mutation(api.publishers.addChannel, {
      instanceId: INSTANCE_ID,
      channelId: "c1",
      channelName: "Cafe",
      channelService: "Instagram",
      channelProfile: "@Café.Du Coin!",
    });
    expect(key).toBe("instagram:caf-du-coin");
  });

  it("keeps the slash of an owner/repo handle (a GitHub repository, ADR-074)", async () => {
    const t = await seed();
    const owner = t.withIdentity(OWNER);
    await owner.mutation(api.publishers.save, CONNECTION);
    const add = (channelId: string, channelProfile: string) =>
      owner.mutation(api.publishers.addChannel, { instanceId: INSTANCE_ID, channelId, channelName: channelProfile, channelService: "github", channelProfile });
    expect(await add("Acme/Site", "Acme/Site")).toBe("github:acme/site");
    expect(await add("acme/my.site", "/acme//my.site/")).toBe("github:acme/my-site");
  });

  it("rejects adding a channel without a Publisher", async () => {
    const t = await seed();
    const owner = t.withIdentity(OWNER);
    await expect(
      owner.mutation(api.publishers.addChannel, {
        instanceId: INSTANCE_ID,
        channelId: "c1",
        channelName: "x",
        channelService: "instagram",
        channelProfile: "x",
      }),
    ).rejects.toThrow("No Publisher configured");
  });
});
