import type { ActionCtx } from "../_generated/server.js";
import { internal } from "../_generated/api.js";
import type { AgentTemplate } from "@opengroow/agent-templates";

function validTimezone(timezone: string | undefined): string {
  if (!timezone) return "UTC";
  try {
    new Intl.DateTimeFormat("en", { timeZone: timezone });
    return timezone;
  } catch {
    return "UTC";
  }
}

function defaultPayload(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return {};
  }
}

/**
 * Creates the Schedules a Template declares with `missionTypes[].defaultSchedule` once
 * the Agent is active. A Mission type that already has a Schedule is left alone. A failure here
 * never fails the activation: the Agent is active and the user can create the Schedule by hand.
 */
export async function createDefaultSchedules(
  ctx: ActionCtx,
  args: { ownerId: string; instanceId: string; templateId: string; template: AgentTemplate; timezone: string | undefined },
): Promise<void> {
  const defaults = (args.template.manifest.missionTypes ?? []).flatMap((missionType) =>
    missionType.defaultSchedule
      ? [{ type: missionType.type, payload: defaultPayload(missionType.payload), frequency: missionType.defaultSchedule }]
      : [],
  );
  if (defaults.length === 0) return;
  try {
    await ctx.runMutation(internal.schedules.createDefaults, {
      ownerId: args.ownerId,
      instanceId: args.instanceId,
      templateId: args.templateId,
      timezone: validTimezone(args.timezone),
      defaults,
    });
  } catch (error) {
    console.error(`Default Schedules of ${args.templateId} were not created`, error);
  }
}
