"use node";

import { action } from "./_generated/server.js";
import { v } from "convex/values";
import { internal } from "./_generated/api.js";
import { randomUUID } from "node:crypto";
import { RUNTIME_NODES_CLEANUP_STALE } from "@opengroow/protocol";
import { env } from "./env";
import { computeConnectTicketExpiresAt, buildPublicExpiresAt } from "./connect_tickets_utils";
import { requireOwnerOfInstance } from "./instance_ownership.js";
import { enqueueCommandMutation } from "./runtime_commands_node.js";
import { buildNodeRunCommand } from "./connect_tickets_command.js";

type ConnectTicketResponse = {
  status?: number;
  ok?: boolean;
  ticket?: {
    id: string;
    instanceId: string;
    openclawName?: string;
    ipv4?: string;
    serverId?: number;
    createdAt: string;
    expiresAt: string;
    connectUrl: string;
    gatewayHttpBaseUrl: string;
    gatewayWsBaseUrl: string;
    gatewayToken: string;
    nodeGatewayHost: string;
    nodeGatewayPort: number;
    nodeGatewayTls: boolean;
    nodeGatewayToken: string;
    nodeRunCommand: string;
  };
  error?: string;
};

export const getLatestActiveTicketForInstance = action({
  args: { instanceId: v.string() },
  handler: async (ctx, args): Promise<ConnectTicketResponse> => {
    const instanceId = args.instanceId.trim();
    await requireOwnerOfInstance(ctx, instanceId);
    const ticket = await ctx.runQuery(internal.connect_tickets.getLatestActiveByInstanceId, {
      instanceId,
    });
    if (!ticket) {
      return { status: 404, error: "No active ticket found" };
    }
    return {
      status: 200,
      ok: true,
      ticket: buildPublicConnectTicket({
        id: ticket.ticketId,
        instanceId: ticket.instanceId,
        openclawName: ticket.openclawName,
        ipv4: ticket.ipv4,
        serverId: ticket.serverId,
        createdAt: ticket.createdAt,
        expiresAt: ticket.expiresAt,
        gatewayToken: ticket.gatewayToken,
      }),
    };
  },
});

export const createConnectTicket = action({
  args: {
    instanceId: v.string(),
    gatewayToken: v.string(),
    openclawName: v.optional(v.string()),
    ipv4: v.optional(v.string()),
    serverId: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<ConnectTicketResponse> => {
    const instanceId = args.instanceId.trim();
    const gatewayToken = args.gatewayToken.trim();
    if (!instanceId || !gatewayToken) {
      return { status: 400, error: "instanceId and gatewayToken are required" };
    }

    const ticketId = randomUUID();
    const createdAt = Date.now();
    const expiresAt = computeConnectTicketExpiresAt(createdAt, env.OPENCLAW_CONNECT_TICKET_TTL_MS);

    await ctx.runMutation(internal.connect_tickets.createAndExpireOthers, {
      ticketId,
      instanceId,
      gatewayToken,
      openclawName: args.openclawName?.trim() || undefined,
      ipv4: args.ipv4?.trim() || undefined,
      serverId: args.serverId,
      createdAt,
      expiresAt,
    });

    // Best-effort: prune this instance's disconnected, never-fully-approved
    // "My Computer" nodes left behind by earlier connect-link attempts
    // (interrupted pairing, identity rotation, etc.) before the user starts a
    // fresh one. Never blocks or fails ticket creation — a missed cleanup
    // just leaves the same ghost entries for next time, same as today.
    try {
      await ctx.runMutation(enqueueCommandMutation, {
        instanceId,
        type: RUNTIME_NODES_CLEANUP_STALE,
        payload: {},
      });
    } catch {
      // best-effort
    }

    return {
      status: 201,
      ok: true,
      ticket: buildPublicConnectTicket({
        id: ticketId,
        instanceId,
        openclawName: args.openclawName?.trim() || undefined,
        ipv4: args.ipv4?.trim() || undefined,
        serverId: args.serverId,
        createdAt,
        expiresAt,
        gatewayToken,
      }),
    };
  },
});

function buildPublicConnectTicket(input: {
  id: string;
  instanceId: string;
  openclawName?: string;
  ipv4?: string;
  serverId?: number;
  createdAt: number;
  expiresAt: number;
  gatewayToken: string;
}): NonNullable<ConnectTicketResponse["ticket"]> {
  const publicBaseUrl = new URL(getConnectPublicBaseUrl());
  const connectUrl = new URL(`/connect/${input.id}`, publicBaseUrl).toString();
  const gatewayHttpBaseUrl = new URL(
    `/connect/${input.id}/gateway`,
    publicBaseUrl,
  ).toString();
  const wsBase = publicBaseUrl
    .toString()
    .replace(/^http/i, "ws")
    .replace(/\/$/, "");
  const gatewayWsBaseUrl = `${wsBase}/connect/${input.id}/gateway`;
  const nodeGatewayHost = publicBaseUrl.hostname;
  const nodeGatewayPort = publicBaseUrl.port
    ? Number(publicBaseUrl.port)
    : publicBaseUrl.protocol === "https:"
      ? 443
      : 80;
  const nodeGatewayTls = publicBaseUrl.protocol === "https:";
  const nodeGatewayToken = input.id;
  const nodeRelayUrl = gatewayWsBaseUrl;
  const nodeRunCommand = buildNodeRunCommand({
    gatewayToken: input.gatewayToken,
    relayUrl: nodeRelayUrl,
    instanceId: input.instanceId,
  });

  return {
    id: input.id,
    instanceId: input.instanceId,
    openclawName: input.openclawName,
    ipv4: input.ipv4,
    serverId: input.serverId,
    createdAt: new Date(input.createdAt).toISOString(),
    expiresAt: buildPublicExpiresAt(input.expiresAt),
    connectUrl,
    gatewayHttpBaseUrl,
    gatewayWsBaseUrl,
    gatewayToken: input.gatewayToken,
    nodeGatewayHost,
    nodeGatewayPort,
    nodeGatewayTls,
    nodeGatewayToken,
    nodeRunCommand,
  };
}

function getConnectPublicBaseUrl(): string {
  const configured = env.OPENCLAW_CONNECT_PUBLIC_BASE_URL;
  return configured.endsWith("/") ? configured : `${configured}/`;
}
