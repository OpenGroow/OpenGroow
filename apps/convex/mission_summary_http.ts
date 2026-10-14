import { httpAction } from "./_generated/server.js";
import { internal } from "./_generated/api.js";
import type { Id } from "./_generated/dataModel.js";
import { verifyAgentHmac } from "./agent_hmac.js";

export const missionSummaryHandler = httpAction(async (ctx, request) => {
  const rawBody = await request.text();

  const auth = await verifyAgentHmac(request, rawBody);
  if (!auth.ok) {
    return new Response(JSON.stringify({ error: auth.error }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (typeof body !== "object" || body === null) {
    return new Response(JSON.stringify({ error: "Body must be an object" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { missionId, summary } = body as Record<string, unknown>;

  if (typeof missionId !== "string" || !missionId) {
    return new Response(JSON.stringify({ error: "missionId is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (typeof summary !== "string" || !summary.trim()) {
    return new Response(JSON.stringify({ error: "summary is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Explicitly reject any attempt to write status through this endpoint
  if ("status" in (body as Record<string, unknown>)) {
    return new Response(JSON.stringify({ error: "status cannot be set through this endpoint" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  await ctx.runMutation(internal.missions.writeSummary, {
    missionId: missionId as Id<"missions">,
    summary: summary.trim(),
  });

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
