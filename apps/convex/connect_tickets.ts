import { internalMutation, internalQuery } from "./_generated/server.js";
import { isConnectTicketExpired } from "./connect_tickets_utils";
import { v } from "convex/values";

export const createAndExpireOthers = internalMutation({
  args: {
    ticketId: v.string(),
    instanceId: v.string(),
    gatewayToken: v.string(),
    openclawName: v.optional(v.string()),
    ipv4: v.optional(v.string()),
    serverId: v.optional(v.number()),
    createdAt: v.number(),
    expiresAt: v.number()
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("connectTickets")
      .withIndex("by_ticket_id", (q) => q.eq("ticketId", args.ticketId))
      .unique();

    const payload = {
      ticketId: args.ticketId,
      instanceId: args.instanceId,
      gatewayToken: args.gatewayToken,
      openclawName: args.openclawName,
      ipv4: args.ipv4,
      serverId: args.serverId,
      createdAt: args.createdAt,
      expiresAt: args.expiresAt
    };

    let ticketDocId;
    if (existing) {
      await ctx.db.patch(existing._id, payload);
      ticketDocId = existing._id;
    } else {
      ticketDocId = await ctx.db.insert("connectTickets", payload);
    }

    const others = await ctx.db
      .query("connectTickets")
      .withIndex("by_instance_id", (q) => q.eq("instanceId", args.instanceId))
      .collect();
    const now = Date.now();
    for (const ticket of others) {
      if (ticket.ticketId === args.ticketId) continue;
      await ctx.db.patch(ticket._id, { expiresAt: now - 1 });
    }

    return ticketDocId;
  }
});

export const getLatestActiveByInstanceId = internalQuery({
  args: { instanceId: v.string() },
  handler: async (ctx, args) => {
    const now = Date.now();
    const tickets = await ctx.db
      .query("connectTickets")
      .withIndex("by_instance_id", (q) => q.eq("instanceId", args.instanceId))
      .order("desc")
      .take(20);
    return tickets.find((t) => !isConnectTicketExpired(t.expiresAt, now)) ?? null;
  }
});

export const getActiveByTicketId = internalQuery({
  args: { ticketId: v.string() },
  handler: async (ctx, args) => {
    const ticket = await ctx.db
      .query("connectTickets")
      .withIndex("by_ticket_id", (q) => q.eq("ticketId", args.ticketId))
      .unique();
    if (!ticket) {
      return null;
    }
    if (isConnectTicketExpired(ticket.expiresAt, Date.now())) {
      return null;
    }
    return ticket;
  }
});
