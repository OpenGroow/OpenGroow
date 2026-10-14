import { insertInstance as insertInstanceWithProject } from "./instance_fixture";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import { internal } from "../_generated/api";
import schema from "../schema";

const modules = {
  "../_generated/api.ts": () => import("../_generated/api.js"),
  "../instances.ts": () => import("../instances.js"),
};

const INSTANCE_ID = "openclaw-instance-order-1";

async function seedInstance(t: ReturnType<typeof convexTest>) {
  const isoNow = new Date().toISOString();
  await t.run(async (ctx) => {
    await insertInstanceWithProject(ctx, {
      jobId: `job-${INSTANCE_ID}`,
      status: "running",
      runtimeStatus: "linked",
      runtimeReady: true,
      createdAt: isoNow,
      openclawId: INSTANCE_ID,
      updatedAt: isoNow,
      providers: [
        {
          kind: "apikey",
          provider: "xiaomi",
          model: "xiaomi/mimo-v2.5",
          inUse: true,
          updatedAt: isoNow,
        },
        {
          kind: "subscription",
          provider: "openai",
          model: "openai/gpt-5.5",
          inUse: false,
          updatedAt: isoNow,
        },
      ],
    });
  });
}

describe("withProviderInUse (via setProviderActiveByOpenclawId / upsertProviderByOpenclawId)", () => {
  it("keeps each Provider's array position when switching which one is in use", async () => {
    const t = convexTest(schema, modules);
    await seedInstance(t);

    // Switching to the openai subscription used to move it to the end of
    // the array (filter-then-append) — the dashboard renders providers in
    // array order, so the row would visibly jump position every time the
    // active provider changed. It must stay at its existing index instead.
    await t.mutation(internal.instances.setProviderActiveByOpenclawId, {
      openclawId: INSTANCE_ID,
      kind: "subscription",
      provider: "openai",
      updatedAt: new Date().toISOString(),
    });

    const instance = await t.run(async (ctx) => {
      return await ctx.db
        .query("instances")
        .withIndex("by_openclaw_id", (q) => q.eq("openclawId", INSTANCE_ID))
        .unique();
    });
    const providers = instance?.providers ?? [];
    expect(providers.map((p) => p.provider)).toEqual(["xiaomi", "openai"]);
    expect(providers.find((p) => p.provider === "xiaomi")?.inUse).toBe(false);
    expect(providers.find((p) => p.provider === "openai")?.inUse).toBe(true);
  });

  it("keeps position on upsert too, not just on the plain activate path", async () => {
    const t = convexTest(schema, modules);
    await seedInstance(t);

    await t.mutation(internal.instances.upsertProviderByOpenclawId, {
      openclawId: INSTANCE_ID,
      kind: "subscription",
      provider: "openai",
      model: "openai/gpt-5.5-mini",
      updatedAt: new Date().toISOString(),
    });

    const instance = await t.run(async (ctx) => {
      return await ctx.db
        .query("instances")
        .withIndex("by_openclaw_id", (q) => q.eq("openclawId", INSTANCE_ID))
        .unique();
    });
    const providers = instance?.providers ?? [];
    expect(providers.map((p) => p.provider)).toEqual(["xiaomi", "openai"]);
    expect(providers.find((p) => p.provider === "openai")?.model).toBe("openai/gpt-5.5-mini");
  });

  it("appends a genuinely new (provider, kind) entry at the end", async () => {
    const t = convexTest(schema, modules);
    await seedInstance(t);

    await t.mutation(internal.instances.upsertProviderByOpenclawId, {
      openclawId: INSTANCE_ID,
      kind: "apikey",
      provider: "anthropic",
      model: "anthropic/claude-4-sonnet",
      updatedAt: new Date().toISOString(),
    });

    const instance = await t.run(async (ctx) => {
      return await ctx.db
        .query("instances")
        .withIndex("by_openclaw_id", (q) => q.eq("openclawId", INSTANCE_ID))
        .unique();
    });
    const providers = instance?.providers ?? [];
    expect(providers.map((p) => p.provider)).toEqual(["xiaomi", "openai", "anthropic"]);
    expect(providers.find((p) => p.provider === "anthropic")?.inUse).toBe(true);
    expect(providers.filter((p) => p.inUse)).toHaveLength(1);
  });
});

describe("setWhatsAppChannelStateByOpenclawId", () => {
  it("stores enabled:false without touching an already-saved phoneNumber", async () => {
    const t = convexTest(schema, modules);
    await seedInstance(t);

    await t.mutation(internal.instances.setWhatsAppChannelStateByOpenclawId, {
      openclawId: INSTANCE_ID,
      linked: false,
      connected: false,
      phoneNumber: "+33612345678",
      updatedAt: new Date().toISOString(),
    });

    await t.mutation(internal.instances.setWhatsAppChannelStateByOpenclawId, {
      openclawId: INSTANCE_ID,
      linked: false,
      connected: false,
      enabled: false,
      updatedAt: new Date().toISOString(),
    });

    const instance = await t.run(async (ctx) => {
      return await ctx.db
        .query("instances")
        .withIndex("by_openclaw_id", (q) => q.eq("openclawId", INSTANCE_ID))
        .unique();
    });
    expect(instance?.whatsAppChannel?.enabled).toBe(false);
    expect(instance?.whatsAppChannel?.phoneNumber).toBe("+33612345678");
  });
});

describe("recordWhatsAppLinkProbeResult", () => {
  async function seedConfiguredButUnlinked(t: ReturnType<typeof convexTest>) {
    const isoNow = new Date().toISOString();
    await t.run(async (ctx) => {
      await insertInstanceWithProject(ctx, {
        jobId: `job-${INSTANCE_ID}`,
        status: "running",
        createdAt: isoNow,
        openclawId: INSTANCE_ID,
        updatedAt: isoNow,
        whatsAppChannel: {
          linked: false,
          connected: false,
          phoneNumber: "+33612345678",
          updatedAt: isoNow,
        },
      });
    });
  }

  it("increments the failure count on each unsuccessful probe and auto-disables at the threshold", async () => {
    const t = convexTest(schema, modules);
    await seedConfiguredButUnlinked(t);

    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const result = await t.mutation(internal.instances.recordWhatsAppLinkProbeResult, {
        openclawId: INSTANCE_ID,
        linked: false,
        connected: false,
        updatedAt: new Date().toISOString(),
      });
      expect(result.linkFailureCount).toBe(attempt);
      expect(result.shouldAutoDisable).toBe(false);
    }

    const thirdResult = await t.mutation(internal.instances.recordWhatsAppLinkProbeResult, {
      openclawId: INSTANCE_ID,
      linked: false,
      connected: false,
      updatedAt: new Date().toISOString(),
    });
    expect(thirdResult.linkFailureCount).toBe(3);
    expect(thirdResult.shouldAutoDisable).toBe(true);

    const instance = await t.run(async (ctx) => {
      return await ctx.db
        .query("instances")
        .withIndex("by_openclaw_id", (q) => q.eq("openclawId", INSTANCE_ID))
        .unique();
    });
    expect(instance?.whatsAppChannel?.enabled).toBe(false);
    expect(instance?.whatsAppChannel?.autoDisabledReason).toMatch(/3 consecutive/);
  });

  it("resets the failure count and clears autoDisabledReason once a probe succeeds", async () => {
    const t = convexTest(schema, modules);
    await seedConfiguredButUnlinked(t);

    await t.mutation(internal.instances.recordWhatsAppLinkProbeResult, {
      openclawId: INSTANCE_ID,
      linked: false,
      connected: false,
      updatedAt: new Date().toISOString(),
    });
    const result = await t.mutation(internal.instances.recordWhatsAppLinkProbeResult, {
      openclawId: INSTANCE_ID,
      linked: true,
      connected: true,
      updatedAt: new Date().toISOString(),
    });

    expect(result.linkFailureCount).toBe(0);
    expect(result.shouldAutoDisable).toBe(false);

    const instance = await t.run(async (ctx) => {
      return await ctx.db
        .query("instances")
        .withIndex("by_openclaw_id", (q) => q.eq("openclawId", INSTANCE_ID))
        .unique();
    });
    expect(instance?.whatsAppChannel?.linkFailureCount).toBe(0);
    expect(instance?.whatsAppChannel?.autoDisabledReason).toBeUndefined();
  });
});

describe("listWhatsAppLinkWatchdogCandidates", () => {
  const originalPlugins = process.env.OPENCLAW_OPTIONAL_PLUGINS;
  beforeEach(() => {
    process.env.OPENCLAW_OPTIONAL_PLUGINS = "whatsapp";
  });
  afterEach(() => {
    if (originalPlugins === undefined) delete process.env.OPENCLAW_OPTIONAL_PLUGINS;
    else process.env.OPENCLAW_OPTIONAL_PLUGINS = originalPlugins;
  });

  async function insertInstance(
    t: ReturnType<typeof convexTest>,
    openclawId: string,
    whatsAppChannel:
      | {
          linked: boolean;
          connected: boolean;
          phoneNumber?: string;
          enabled?: boolean;
          updatedAt: string;
        }
      | undefined,
  ) {
    const isoNow = new Date().toISOString();
    await t.run(async (ctx) => {
      await insertInstanceWithProject(ctx, {
        jobId: `job-${openclawId}`,
        status: "running",
        createdAt: isoNow,
        openclawId,
        updatedAt: isoNow,
        whatsAppChannel,
      });
    });
  }

  it("only returns configured, unlinked, enabled channels", async () => {
    const t = convexTest(schema, modules);
    const isoNow = new Date().toISOString();

    await insertInstance(t, "candidate-unlinked", {
      linked: false,
      connected: false,
      phoneNumber: "+33612345678",
      updatedAt: isoNow,
    });
    await insertInstance(t, "already-linked", {
      linked: true,
      connected: true,
      phoneNumber: "+33612345679",
      updatedAt: isoNow,
    });
    await insertInstance(t, "manually-disabled", {
      linked: false,
      connected: false,
      phoneNumber: "+33612345680",
      enabled: false,
      updatedAt: isoNow,
    });
    await insertInstance(t, "no-number-yet", {
      linked: false,
      connected: false,
      updatedAt: isoNow,
    });
    await insertInstance(t, "no-whatsapp-channel-at-all", undefined);

    const candidates = await t.query(internal.instances.listWhatsAppLinkWatchdogCandidates, {});

    expect(candidates.map((c) => c.openclawId)).toEqual(["candidate-unlinked"]);
  });

  it("returns nothing when the WhatsApp plugin is not enabled, so no channel is probed or auto-disabled", async () => {
    process.env.OPENCLAW_OPTIONAL_PLUGINS = "";
    const t = convexTest(schema, modules);
    await insertInstance(t, "candidate-unlinked", {
      linked: false,
      connected: false,
      phoneNumber: "+33612345678",
      updatedAt: new Date().toISOString(),
    });

    expect(await t.query(internal.instances.listWhatsAppLinkWatchdogCandidates, {})).toEqual([]);
  });
});
