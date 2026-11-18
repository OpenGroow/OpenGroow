"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { NativeSelect } from "@/components/ui/native-select";
import { extractConvexErrorMessage } from "@/src/lib/convex-error";
import { titleCase } from "@/src/lib/mission-type";

// "Routed to" (ADR-076): where a Source goes when it is produced. Shared by the
// Sources list and the Source page.

export type Target = { templateId: string; agentName: string; missionType: string; label: string; description: string };

export type RoutableSource = {
  _id: string;
  routeTo?: { templateId: string; missionType: string };
  routing?: { state: string; templateId: string; missionType: string; rationale: string };
};

const AUTO_TARGET = "auto";
const targetKey = (target: { templateId: string; missionType: string }) => `${target.templateId}::${target.missionType}`;

// The Agent id is `@scope/slug`; the slug reads as the Agent's name.
export function agentLabel(templateId: string): string {
  return titleCase(templateId.split("/").pop() ?? templateId, "-");
}

/** The producers a Source can be routed to. */
export function useRouteTargets(instanceId: string): Target[] {
  const targets = useQuery(api.source_routing.listTargets, { instanceId });
  return Array.isArray(targets) ? (targets as Target[]) : [];
}

/** What Produce will use: the producer chosen by hand, else the router's own
 * proposal. `undefined` means the router decides when Produce is pressed. */
export function proposedTarget(source: RoutableSource) {
  return source.routeTo ?? (source.routing?.state === "proposed" ? source.routing : undefined);
}

export function RouteTargetSelect({ source, targets, className }: { source: RoutableSource; targets: Target[]; className?: string }) {
  const setRouteTarget = useMutation(api.source_routing.setRouteTarget);
  const current = proposedTarget(source);
  const value = current ? targetKey(current) : AUTO_TARGET;

  async function onChange(next: string): Promise<void> {
    const target = targets.find((entry) => targetKey(entry) === next);
    try {
      await setRouteTarget({ sourceId: source._id as Id<"sources">, target: target ? { templateId: target.templateId, missionType: target.missionType } : null });
    } catch (error: unknown) {
      window.alert(extractConvexErrorMessage(error, "Could not change where the Source is routed to."));
    }
  }

  return (
    <NativeSelect aria-label="Routed to" className={className} value={value} onChange={(event) => void onChange(event.target.value)}>
      <option value={AUTO_TARGET}>Auto (router decides)</option>
      {targets.map((target) => (
        <option key={targetKey(target)} value={targetKey(target)}>
          {agentLabel(target.templateId)} · {target.label}
        </option>
      ))}
    </NativeSelect>
  );
}

/** Produce a Source: from its proposal or chosen producer, else the router decides. */
export function useProduceSource(sourceId: string): { produce: () => Promise<void>; busy: boolean } {
  const forceProduction = useMutation(api.source_routing.forceProduction);
  const [busy, setBusy] = useState(false);
  async function produce(): Promise<void> {
    setBusy(true);
    try {
      await forceProduction({ sourceId: sourceId as Id<"sources"> });
    } catch (error: unknown) {
      window.alert(extractConvexErrorMessage(error, "Failed to start production."));
    } finally {
      setBusy(false);
    }
  }
  return { produce, busy };
}
