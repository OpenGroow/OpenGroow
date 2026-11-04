"use client";

import Link from "next/link";
import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
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
  declaredTargets: string[];
  mapped: boolean;
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
  const setPublishTarget = useMutation(api.publications.setPublishTarget);
  const setPublishAt = useMutation(api.publications.setPublishAt);
  const live = useQuery(api.publications.listForMission, { missionId: missionId as Id<"missions"> });
  const publications = live ?? publish.publications;
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

  async function changeTarget(target: string) {
    setError(null);
    try {
      await setPublishTarget({ missionId: missionId as Id<"missions">, target });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not change the Publish target");
    }
  }

  return (
    <Card className="grid gap-4 p-6" data-testid="publish-section">
      <h2 className="m-0 text-lg font-semibold text-foreground">Publication</h2>
      <div className="grid gap-2">
        <label htmlFor="publish-target" className="text-xs font-semibold text-muted-foreground">
          Publish target
        </label>
        <select
          id="publish-target"
          data-testid="publish-target"
          className="w-full max-w-xs rounded-md border border-border bg-background px-3 py-2 text-sm"
          value={publish.target ?? ""}
          disabled={!editable}
          onChange={(e) => { void changeTarget(e.target.value); }}
        >
          {publish.target === null && <option value="">Choose a target</option>}
          {publish.declaredTargets.map((target) => (
            <option key={target} value={target}>{target}</option>
          ))}
        </select>
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
        {!publish.mapped && (
          <p data-testid="publish-unmapped" className="m-0 text-sm text-destructive">
            This target is not configured, so publishing is disabled.{" "}
            <Link
              href={`/projects/${encodeURIComponent(instanceId)}/publishers`}
              className="underline"
            >
              Open the Publishers page
            </Link>
          </p>
        )}
      </div>
      {publications.length > 0 && (
        <ul className="m-0 grid list-none gap-2 p-0 text-sm" data-testid="publications">
          {publications.map((publication) => (
            <li key={publication.target} data-testid={`publication-${publication.target}`}>
              <span className="font-semibold">{publication.target}</span>: {publication.status}
              {publication.status === "scheduled" && publication.scheduledAt !== undefined && (
                <> for {new Date(publication.scheduledAt).toLocaleString()}</>
              )}
              {publication.externalUrl && (
                <>
                  {" "}
                  <a href={publication.externalUrl} className="underline" target="_blank" rel="noreferrer">
                    view post
                  </a>
                </>
              )}
              {publication.error && <span className="text-destructive"> ({publication.error})</span>}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
