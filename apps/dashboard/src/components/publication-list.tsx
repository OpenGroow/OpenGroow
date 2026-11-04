"use client";

import { useState } from "react";
import { useAction, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { extractConvexErrorMessage } from "@/src/lib/convex-error";

/**
 * Every Publication of a Mission (ADR-069): status, external URL or id,
 * scheduled date and error. A `failed` one can be retried on its own.
 */
export function PublicationList({ missionId, title }: { missionId: string; title?: string }) {
  const publications = useQuery(api.publications.listForMission, { missionId: missionId as Id<"missions"> });
  const retryPublication = useAction(api.missions_node.retryPublication);
  const [retrying, setRetrying] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!publications || publications.length === 0) return null;

  async function retry(publicationId: Id<"publications">) {
    setError(null);
    setRetrying(publicationId);
    try {
      await retryPublication({ publicationId });
    } catch (err) {
      setError(extractConvexErrorMessage(err, "Could not retry the Publication"));
    } finally {
      setRetrying(null);
    }
  }

  const body = (
    <div className="grid gap-2" data-testid="publications">
      {title && <h2 className="m-0 text-lg font-semibold text-foreground">{title}</h2>}
      <ul className="m-0 grid list-none gap-2 p-0 text-sm">
        {publications.map((publication) => (
          <li key={publication.id} className="flex flex-wrap items-center gap-2" data-testid={`publication-${publication.target}`}>
            <span className="font-semibold">{publication.target}</span>: {publication.status}
            {publication.externalUrl ? (
              <a href={publication.externalUrl} className="underline" target="_blank" rel="noreferrer">
                view post
              </a>
            ) : (
              publication.externalId && <span className="text-muted-foreground">id {publication.externalId}</span>
            )}
            {publication.scheduledAt !== undefined && (
              <span className="text-muted-foreground">scheduled {new Date(publication.scheduledAt).toLocaleString()}</span>
            )}
            {publication.error && <span className="text-destructive">({publication.error})</span>}
            {publication.status === "failed" && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={retrying !== null}
                onClick={() => void retry(publication.id)}
              >
                {retrying === publication.id ? "Retrying…" : "Retry"}
              </Button>
            )}
          </li>
        ))}
      </ul>
      {error && <p className="m-0 text-sm text-destructive">{error}</p>}
    </div>
  );
  return title ? <Card className="grid gap-4 p-6">{body}</Card> : body;
}
