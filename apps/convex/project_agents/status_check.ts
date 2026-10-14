"use node";

import type { AgentTemplate, ConfigCompletenessStatus, StatusCheckContract } from "@opengroow/agent-templates";
import { callMcpTool } from "../mcp_node.js";
import { resolveTemplateMcpEndpoint } from "../mcp_endpoint.js";

// Bounded timeout for a Config Completeness check (issue #320, ADR-034) — this
// is a lightweight read-only status call, not a long-running job poll, so it
// gets a short budget rather than the multi-minute `callTimeout` used for
// External Job polling.
const CONFIG_COMPLETENESS_TIMEOUT_MS = 15_000;

export type ConfigCompletenessResult =
  | { outcome: "configured" }
  | { outcome: "not_configured"; message?: string; dashboardUrl?: string }
  | { outcome: "key_rejected"; message: string };

/**
 * Calls a Template's declarative `statusCheck` MCP tool (issue #320, ADR-034)
 * to ask the MCP whether the Project identified by `apiKey` is fully
 * configured on its own side. The response contract is fixed and MCP-owned:
 * `{ configured: boolean, dashboardUrl: string, message?: string }` —
 * OpenGroow never derives its own message from provider-specific field names.
 *
 * A thrown/rejected MCP call (bad auth, unreachable server, malformed
 * response) is classified as `key_rejected`: from OpenGroow's point of view,
 * the apiKey could not be used to identify a Project, and asking the user to
 * re-open the activation form with a corrected key is the only recovery.
 */
export async function checkConfigCompleteness(
  template: AgentTemplate,
  contract: StatusCheckContract,
  apiKey: string,
): Promise<ConfigCompletenessResult> {
  const { mcpUrl, headers } = resolveTemplateMcpEndpoint(template, contract.server, apiKey);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CONFIG_COMPLETENESS_TIMEOUT_MS);
  let raw: unknown;
  try {
    raw = await callMcpTool(mcpUrl, contract.mcpTool, {}, { headers, signal: controller.signal });
  } catch (err) {
    return {
      outcome: "key_rejected",
      message: `The API key was rejected by ${contract.server}: ${err instanceof Error ? err.message : "Unknown error"}`,
    };
  } finally {
    clearTimeout(timeout);
  }

  // The wire payload is untrusted MCP output, not a validated
  // ConfigCompletenessStatus — read defensively (typeof checks below) even
  // though the type documents the fixed, MCP-owned contract we expect.
  const payload = (raw ?? {}) as Partial<ConfigCompletenessStatus>;
  if (payload.configured === true) {
    return { outcome: "configured" };
  }
  return {
    outcome: "not_configured",
    message: typeof payload.message === "string" ? payload.message : undefined,
    dashboardUrl: typeof payload.dashboardUrl === "string" ? payload.dashboardUrl : undefined,
  };
}
