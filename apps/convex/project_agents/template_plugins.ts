import type { ActionCtx } from "../_generated/server.js";
import type { TemplatePlugin } from "@opengroow/agent-templates";
import {
  RUNTIME_OPENCLAW_EXEC,
  RUNTIME_PLUGINS_INSTALL,
  type RuntimePluginsInstallResultPayload,
} from "@opengroow/protocol";
import { sendAndAwait, isCompoundUnsupported, parseOpenClawExecResult } from "./runtime_calls.js";

/**
 * Copies the Template's OpenClaw plugins into the Instance (#661, ADR-055).
 * Returns the ids of the plugins that actually changed: only those need the
 * Gateway to restart, an identical plugin already installed is a no-op, which
 * keeps reconciliation (run on every install and reprovisioning) from
 * restarting the Gateway for nothing. Throws with a readable message on failure.
 */
export async function installTemplatePlugins(
  ctx: ActionCtx,
  instanceId: string,
  plugins: readonly TemplatePlugin[],
): Promise<string[]> {
  const result = await sendAndAwait(ctx, instanceId, RUNTIME_PLUGINS_INSTALL, { plugins });
  const payload = result.payload as RuntimePluginsInstallResultPayload | undefined;
  if (!result.found || !payload?.ok) {
    if (isCompoundUnsupported(result)) {
      throw new Error("This Project's runtime does not support installing Template plugins yet; update its OpenClaw runtime");
    }
    throw new Error(payload?.error ?? "Plugin install failed");
  }
  return payload.data.plugins.filter((plugin) => plugin.changed).map((plugin) => plugin.id);
}

/**
 * OpenClaw only loads installed plugin code when the Gateway starts, so a plugin
 * that was installed or changed needs a restart to take effect (OpenClaw docs,
 * "Installing, updating, or uninstalling plugin code requires a Gateway
 * restart"). The control socket restarts the Gateway container once it has
 * answered; the Instance is unreachable for a few seconds afterwards, so this
 * is the last runtime call of an activation, refresh or reconciliation. A
 * failure is reported, not thrown: the install stands and the plugin loads on
 * the Gateway's next start.
 */
export async function restartGatewayForPlugins(ctx: ActionCtx, instanceId: string): Promise<void> {
  try {
    const result = await sendAndAwait(ctx, instanceId, RUNTIME_OPENCLAW_EXEC, {
      commandText: "openclaw gateway restart",
    });
    parseOpenClawExecResult(result, "Gateway restart failed");
  } catch (error) {
    console.warn(
      `[project_agents/template_plugins] Gateway restart after plugin install failed for ${instanceId}: ${
        error instanceof Error ? error.message : "Unknown error"
      }`,
    );
  }
}
