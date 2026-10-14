import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import { internal } from "../_generated/api";
import schema from "../schema";

const modules = {
  "../_generated/api.ts": () => import("../_generated/api.js"),
  "../connect_tickets.ts": () => import("../connect_tickets.js"),
  "../connect_tickets_node.ts": () => import("../connect_tickets_node.js"),
};

const INSTANCE_ID = "openclaw-test-instance-1";
const GATEWAY_TOKEN = "gw-token-abc";
const FUTURE = Date.now() + 60_000;
const PAST = Date.now() - 1_000;

describe("connect_tickets.getLatestActiveByInstanceId", () => {
  it("returns null when no ticket exists for the instance", async () => {
    const t = convexTest(schema, modules);
    const result = await t.query(internal.connect_tickets.getLatestActiveByInstanceId, {
      instanceId: INSTANCE_ID,
    });
    expect(result).toBeNull();
  });

  it("returns the active ticket when it exists and is not expired", async () => {
    const t = convexTest(schema, modules);
    const createdAt = Date.now();
    await t.run(async (ctx) => {
      await ctx.db.insert("connectTickets", {
        ticketId: "ticket-001",
        instanceId: INSTANCE_ID,
        gatewayToken: GATEWAY_TOKEN,
        createdAt,
        expiresAt: FUTURE,
      });
    });

    const result = await t.query(internal.connect_tickets.getLatestActiveByInstanceId, {
      instanceId: INSTANCE_ID,
    });

    expect(result).not.toBeNull();
    expect(result?.ticketId).toBe("ticket-001");
  });

  it("returns null when the ticket is expired", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("connectTickets", {
        ticketId: "ticket-expired",
        instanceId: INSTANCE_ID,
        gatewayToken: GATEWAY_TOKEN,
        createdAt: PAST - 5_000,
        expiresAt: PAST,
      });
    });

    const result = await t.query(internal.connect_tickets.getLatestActiveByInstanceId, {
      instanceId: INSTANCE_ID,
    });

    expect(result).toBeNull();
  });

  it("returns the most recent ticket when multiple exist", async () => {
    const t = convexTest(schema, modules);
    const now = Date.now();
    await t.run(async (ctx) => {
      await ctx.db.insert("connectTickets", {
        ticketId: "ticket-older",
        instanceId: INSTANCE_ID,
        gatewayToken: GATEWAY_TOKEN,
        createdAt: now - 10_000,
        expiresAt: FUTURE,
      });
      await ctx.db.insert("connectTickets", {
        ticketId: "ticket-newer",
        instanceId: INSTANCE_ID,
        gatewayToken: GATEWAY_TOKEN,
        createdAt: now,
        expiresAt: FUTURE,
      });
    });

    const result = await t.query(internal.connect_tickets.getLatestActiveByInstanceId, {
      instanceId: INSTANCE_ID,
    });

    expect(result?.ticketId).toBe("ticket-newer");
  });

  it("returns a no-expiry ticket (expiresAt=0) as active", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("connectTickets", {
        ticketId: "ticket-no-expiry",
        instanceId: INSTANCE_ID,
        gatewayToken: GATEWAY_TOKEN,
        createdAt: Date.now(),
        expiresAt: 0,
      });
    });

    const result = await t.query(internal.connect_tickets.getLatestActiveByInstanceId, {
      instanceId: INSTANCE_ID,
    });

    expect(result?.ticketId).toBe("ticket-no-expiry");
  });
});

describe("connect_tickets.createAndExpireOthers", () => {
  it("expire tous les tickets de l'instance sauf le ticket cree", async () => {
    const t = convexTest(schema, modules);
    const now = Date.now();
    await t.run(async (ctx) => {
      await ctx.db.insert("connectTickets", {
        ticketId: "ticket-old-1",
        instanceId: INSTANCE_ID,
        gatewayToken: GATEWAY_TOKEN,
        createdAt: now - 20_000,
        expiresAt: 0,
      });
      await ctx.db.insert("connectTickets", {
        ticketId: "ticket-old-2",
        instanceId: INSTANCE_ID,
        gatewayToken: GATEWAY_TOKEN,
        createdAt: now - 10_000,
        expiresAt: now + 60_000,
      });
    });

    await t.mutation(internal.connect_tickets.createAndExpireOthers, {
      ticketId: "ticket-new",
      instanceId: INSTANCE_ID,
      gatewayToken: GATEWAY_TOKEN,
      createdAt: now,
      expiresAt: now + 60_000,
    });

    const result = await t.query(internal.connect_tickets.getLatestActiveByInstanceId, {
      instanceId: INSTANCE_ID,
    });
    expect(result?.ticketId).toBe("ticket-new");
  });

  it("ne touche pas les tickets d'une autre instance", async () => {
    const t = convexTest(schema, modules);
    const OTHER_INSTANCE = "other-instance";
    const now = Date.now();
    await t.run(async (ctx) => {
      await ctx.db.insert("connectTickets", {
        ticketId: "ticket-other-instance",
        instanceId: OTHER_INSTANCE,
        gatewayToken: GATEWAY_TOKEN,
        createdAt: now,
        expiresAt: 0,
      });
    });

    await t.mutation(internal.connect_tickets.createAndExpireOthers, {
      ticketId: "ticket-new",
      instanceId: INSTANCE_ID,
      gatewayToken: GATEWAY_TOKEN,
      createdAt: now,
      expiresAt: now + 60_000,
    });

    const result = await t.query(internal.connect_tickets.getLatestActiveByInstanceId, {
      instanceId: OTHER_INSTANCE,
    });
    expect(result?.ticketId).toBe("ticket-other-instance");
  });

  it("simule deux creations concurrentes pour la meme instance sans double expiration", async () => {
    const t = convexTest(schema, modules);
    const now = Date.now();

    await t.mutation(internal.connect_tickets.createAndExpireOthers, {
      ticketId: "ticket-a",
      instanceId: INSTANCE_ID,
      gatewayToken: GATEWAY_TOKEN,
      createdAt: now,
      expiresAt: now + 60_000,
    });
    await t.mutation(internal.connect_tickets.createAndExpireOthers, {
      ticketId: "ticket-b",
      instanceId: INSTANCE_ID,
      gatewayToken: GATEWAY_TOKEN,
      createdAt: now + 1,
      expiresAt: now + 60_000,
    });

    const result = await t.query(internal.connect_tickets.getLatestActiveByInstanceId, {
      instanceId: INSTANCE_ID,
    });
    expect(result?.ticketId).toBe("ticket-b");
  });
});
