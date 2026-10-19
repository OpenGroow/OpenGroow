"use client";

import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { ArrowRight, CircleAlert, Clock, FileText, ListChecks } from "lucide-react";
import type { AgentManifest } from "@convex/template_manifest_contract";
import { Card, CardContent } from "@/components/ui/card";
import { PanelIcon } from "@/components/opengroow/settings-panel";
import { StatTile } from "@/components/opengroow/stat-tile";
import { StatusBadge } from "@/components/opengroow/status-badge";
import { missionStatus } from "@/components/opengroow/mission-status";
import { relativeTime } from "@/src/lib/relative-time";

function titleCase(type: string): string {
  return type
    .split("_")
    .filter(Boolean)
    .map((word) => word[0]!.toUpperCase() + word.slice(1))
    .join(" ");
}

/**
 * The Agent's Overview body: counts of its Missions by outcome, then its most
 * recent Missions, each linking to the Mission page.
 */
export function AgentOverviewMissions({
  runtimeInstanceId,
  projectId,
  manifest,
}: {
  runtimeInstanceId: string;
  projectId: string;
  manifest: AgentManifest;
}) {
  const overview = useQuery(
    api.missions.overviewByTemplate,
    runtimeInstanceId ? { instanceId: runtimeInstanceId, templateId: manifest.id } : "skip",
  );
  if (!overview) return null;

  const projectPath = `/projects/${encodeURIComponent(projectId)}`;
  const labelFor = (type: string) => manifest.missionTypes?.find((t) => t.type === type)?.label ?? titleCase(type);
  // Counts cover the latest Missions only, so a full window reads "N+".
  const shown = (n: number) => (overview.truncated ? `${n}+` : n);

  return (
    <div className="grid gap-6">
      <div className="grid gap-6 md:grid-cols-3">
        <StatTile icon={Clock} tone="research" label="In progress" value={shown(overview.counts.doing)} />
        <StatTile icon={FileText} tone="creative" label="To validate" value={shown(overview.counts.toValidate)} />
        <StatTile icon={CircleAlert} tone="error" label="Failed" value={shown(overview.counts.failed)} />
      </div>

      <Card>
        <CardContent className="grid gap-4">
          <div className="flex items-center gap-4">
            <PanelIcon icon={ListChecks} tone="violet" />
            <h2 className="m-0 flex-1 text-lg font-semibold text-foreground">Recent Missions</h2>
            <Link
              href={`${projectPath}/missions`}
              className="flex items-center gap-1 text-sm font-medium text-primary hover:underline"
            >
              View all
              <ArrowRight className="size-4" />
            </Link>
          </div>
          {overview.recent.length === 0 ? (
            <p className="m-0 text-sm text-muted-foreground">No Missions yet for this Agent.</p>
          ) : (
            <ul className="m-0 grid list-none divide-y divide-border p-0">
              {overview.recent.map((mission) => {
                const status = missionStatus(mission.status);
                return (
                  <li key={mission._id}>
                    <Link
                      href={`${projectPath}/missions/${mission._id}`}
                      className="flex items-center justify-between gap-4 rounded-lg py-3 transition-colors hover:bg-accent/50"
                    >
                      <span className="grid min-w-0 gap-0.5">
                        <span className="truncate text-base text-foreground">{labelFor(mission.type)}</span>
                        <span className="text-sm text-muted-foreground tabular-nums">
                          {relativeTime(mission.updatedAt)}
                        </span>
                      </span>
                      <StatusBadge tone={status.tone} label={status.label} />
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
