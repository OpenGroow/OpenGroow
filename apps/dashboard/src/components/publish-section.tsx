"use client";

import Link from "next/link";
import { useState } from "react";
import { useAction, useMutation } from "convex/react";
import { PublicationList } from "@/src/components/publication-list";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { Card } from "@/components/ui/card";

/**
 * Where a Mission will be published (ADR-069): the logical Publish target
 * (editable by the reviewer), a pointer to the Publishers page when it is not
 * mapped, and the status of each Publication.
 */

export type PublishProjection = {
  target: string | null;
  /** Every target the Mission goes to (one Publication each). */
  targets: string[];
  declaredTargets: string[];
  /** Every target is mapped to a channel. */
  mapped: boolean;
  unmappedTargets: string[];
  /** The Project has a Publisher with an API key. */
  publisherReady: boolean;
  /** The date the reviewer chose (epoch ms); absent = publish immediately. */
  publishAt?: number;
  publications: Array<{
    target: string;
    status: "pending" | "scheduled" | "published" | "failed";
    externalId?: string;
    externalUrl?: string;
    scheduledAt?: number;
    error?: string;
  }>;
};

/** Epoch ms to the `YYYY-MM-DDTHH:mm` local time a datetime-local input expects. */
function toLocalInput(ms: number | undefined): string {
  if (ms === undefined) return "";
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function PublishSection({
  missionId,
  instanceId,
  publish,
  editable,
}: {
  missionId: string;
  instanceId: string;
  publish: PublishProjection;
  editable: boolean;
}) {
  const setPublishTargets = useAction(api.publisher_node.setPublishTargets);
  const setPublishAt = useMutation(api.publications.setPublishAt);
  const [error, setError] = useState<string | null>(null);

  // The projection is fetched once, so the date is held locally after the first edit.
  const [publishAtInput, setPublishAtInput] = useState(() => toLocalInput(publish.publishAt));

  async function changePublishAt(value: string) {
    setError(null);
    setPublishAtInput(value);
    const at = value === "" ? null : new Date(value).getTime();
    if (at !== null && !Number.isFinite(at)) return;
    try {
      await setPublishAt({ missionId: missionId as Id<"missions">, publishAt: at });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not change the publication date");
    }
  }

  // Held locally after the first edit, like the date (the projection is fetched once).
  const [targets, setTargets] = useState(publish.targets);

  async function toggleTarget(target: string, checked: boolean) {
    const next = checked ? [...targets, target] : targets.filter((t) => t !== target);
    if (next.length === 0) {
      setError("At least one Publish target is required");
      return;
    }
    // Keep the declared order, whatever the order of the clicks.
    const ordered = publish.declaredTargets.filter((t) => next.includes(t));
    setError(null);
    const previous = targets;
    setTargets(ordered);
    try {
      await setPublishTargets({ missionId: missionId as Id<"missions">, targets: ordered });
    } catch (err) {
      setTargets(previous);
      setError(err instanceof Error ? err.message : "Could not change the Publish targets");
    }
  }

  const unmapped = publish.unmappedTargets.filter((t) => targets.includes(t));
  const publishAtMs = publishAtInput === "" ? undefined : new Date(publishAtInput).getTime();

  return (
    <Card className="grid gap-4 p-6" data-testid="publish-section">
      <h2 className="m-0 text-lg font-semibold text-foreground">Publication</h2>
      <div className="grid gap-2">
        <fieldset className="m-0 grid gap-2 border-0 p-0" disabled={!editable}>
          <legend className="mb-1 p-0 text-xs font-semibold text-muted-foreground">Publish targets</legend>
          {publish.declaredTargets.map((target) => (
            <label key={target} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                data-testid={`publish-target-${target}`}
                checked={targets.includes(target)}
                onChange={(e) => { void toggleTarget(target, e.target.checked); }}
              />
              {target}
            </label>
          ))}
        </fieldset>
        <p data-testid="publish-summary" className="m-0 text-sm text-muted-foreground">
          Goes to {targets.join(", ")}{" "}
          {publishAtMs !== undefined && Number.isFinite(publishAtMs)
            ? `on ${new Date(publishAtMs).toLocaleString()}`
            : "immediately"}
          .
        </p>
        <label htmlFor="publish-at" className="mt-2 text-xs font-semibold text-muted-foreground">
          Publish at (leave empty to publish immediately)
        </label>
        <input
          id="publish-at"
          data-testid="publish-at"
          type="datetime-local"
          className="w-full max-w-xs rounded-md border border-border bg-background px-3 py-2 text-sm"
          value={publishAtInput}
          disabled={!editable}
          onChange={(e) => { void changePublishAt(e.target.value); }}
        />
        {error && <p className="m-0 text-sm text-destructive">{error}</p>}
        {(unmapped.length > 0 || !publish.publisherReady) && (
          <p data-testid="publish-unmapped" className="m-0 text-sm text-destructive">
            {!publish.publisherReady
              ? "The Publisher has no API key, so publishing is disabled."
              : `Not configured: ${unmapped.join(", ")}. Publishing is disabled.`}{" "}
            <Link
              href={`/projects/${encodeURIComponent(instanceId)}/publishers`}
              className="underline"
            >
              Open the Publishers page
            </Link>
          </p>
        )}
      </div>
      <PublicationList missionId={missionId} />
    </Card>
  );
}
