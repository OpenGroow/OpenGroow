import { RUNTIME_PLUGINS_INSTALL_RESULT, type RuntimePluginsInstallResultPayload } from "@opengroow/protocol";
import { createEventMessage } from "./event-message.js";
import type { CommandHandler } from "./types.js";

/**
 * Copies Template-declared OpenClaw plugins into the Instance (#661). The
 * control socket, which runs beside the Gateway, owns validation and the
 * actual install; this only relays and reports which plugins changed.
 */
type InstalledPlugins = RuntimePluginsInstallResultPayload["data"]["plugins"];

export const handlePluginsInstall: CommandHandler = async (command, deps) => {
  const plugins = (command.payload as { plugins?: unknown } | undefined)?.plugins;
  const result = (ok: boolean, data: InstalledPlugins, error?: string) =>
    createEventMessage(RUNTIME_PLUGINS_INSTALL_RESULT, command.id, {
      commandId: command.id,
      instanceId: deps.getRuntimeInstanceId(),
      ok,
      ...(error !== undefined ? { error } : {}),
      data: { plugins: data },
    });

  if (!Array.isArray(plugins) || plugins.length === 0) {
    return result(false, [], "plugins is required and must be a non-empty array");
  }

  try {
    const installed = await deps.gatewayClient.requestGatewayControl<{ plugins: InstalledPlugins }>("/plugins/install", { plugins });
    return result(true, installed.plugins);
  } catch (error) {
    return result(false, [], error instanceof Error ? error.message : "Failed to install plugins");
  }
};
