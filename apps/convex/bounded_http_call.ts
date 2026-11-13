import type { FunctionReference } from "convex/server";
import type { AgentTemplate } from "@opengroow/agent-templates";
import { internal } from "./_generated/api.js";
import type { ActionCtx } from "./_generated/server.js";
import type { Doc } from "./_generated/dataModel.js";
import { indexingOutcomeZ, type IndexingOutcome } from "./indexing.js";
import { resolveMcpActivationUrl } from "./mcp_activation_url.js";

// The one executor of a Template's bounded HTTP effects (ADR-020): a review
// action's effect and `publish.onPublished` (ADR-074). The Template names one of
// its `mcpServers` and a path; Convex resolves the origin and sends the Agent's
// credentials, so a Template never embeds a URL or a secret.

const BOUNDED_HTTP_TIMEOUT_MS = 120_000;

const getProjectAgentByInstanceAndTemplateQuery = internal.project_agents
  .getByInstanceAndTemplate as unknown as FunctionReference<
  "query",
  "internal",
  { instanceId: string; templateId: string },
  { config?: Record<string, unknown> } | null
>;

export type BoundedHttpCall = {
  mission: Pick<Doc<"missions">, "instanceId" | "templateId">;
  template: AgentTemplate;
  server: string;
  method: "POST";
  /** Already interpolated and encoded. */
  path: string;
  /** Already interpolated. */
  body?: Record<string, unknown>;
  responseIndexingField?: string;
  /** Names the call in error messages, e.g. `Action "publish" effect`. */
  label: string;
};

/**
 * Sends the call and returns the indexing outcome found at
 * `responseIndexingField`, if any. Throws on an unknown server, a non-2xx
 * answer (with the service's `details`/`error`), a timeout, or a present but
 * malformed indexing outcome (an upstream contract regression).
 */
export async function callBoundedHttpEffect(ctx: ActionCtx, call: BoundedHttpCall): Promise<IndexingOutcome | undefined> {
  const server = call.template.manifest.mcpServers.find((s) => s.name === call.server);
  if (!server) {
    throw new Error(`Effect server "${call.server}" not found in template "${call.mission.templateId}" manifest`);
  }
  const origin = new URL(resolveMcpActivationUrl(server)).origin;

  const projectAgent = await ctx.runQuery(getProjectAgentByInstanceAndTemplateQuery, {
    instanceId: call.mission.instanceId,
    templateId: call.mission.templateId,
  });
  const apiKeyRaw = projectAgent?.config?.apiKey;
  const apiKey = typeof apiKeyRaw === "string" && apiKeyRaw.length > 0 ? apiKeyRaw : undefined;
  const headers: Record<string, string> = {
    ...(server.headers ?? {}),
    ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    "Content-Type": "application/json",
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), BOUNDED_HTTP_TIMEOUT_MS);
  let responseData: Record<string, unknown> = {};
  try {
    const response = await fetch(`${origin}${call.path}`, {
      method: call.method,
      headers,
      ...(call.body !== undefined ? { body: JSON.stringify(call.body) } : {}),
      signal: controller.signal,
    });
    if (!response.ok) {
      let errorDetail = "";
      try {
        const errBody = (await response.json()) as Record<string, unknown>;
        const detail = errBody.details ?? errBody.error;
        if (detail !== undefined) {
          errorDetail = ` — ${typeof detail === "string" ? detail : JSON.stringify(detail)}`;
        }
      } catch {
        // Body may not be JSON
      }
      throw new Error(`${call.label} failed: ${response.status} ${response.statusText}${errorDetail}`);
    }
    if (call.responseIndexingField) {
      try {
        responseData = (await response.json()) as Record<string, unknown>;
      } catch {
        // Response may not be JSON — treat as no indexing data
      }
    }
  } finally {
    clearTimeout(timeout);
  }

  if (!call.responseIndexingField) return undefined;
  const rawIndexing = responseData[call.responseIndexingField];
  if (rawIndexing === undefined) return undefined;
  const parsed = indexingOutcomeZ.safeParse(rawIndexing);
  if (!parsed.success) throw new Error(`${call.label} returned an invalid indexing outcome`);
  return parsed.data;
}
