"use client";

import { useState } from "react";
import { useAction, useQuery } from "convex/react";
import { ExternalLink, Layers } from "lucide-react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { StatusBadge } from "@/components/opengroow/status-badge";
import { PlatformLogo, platformName } from "@/src/components/platform-logo";
import { cn } from "@/lib/utils";
import { extractConvexErrorMessage } from "@/src/lib/convex-error";

const STATUS: Record<string, { label: string; tone: "active" | "info" | "progress" | "warning" | "error" | "neutral" }> = {
  published: { label: "Published", tone: "active" },
  scheduled: { label: "Scheduled", tone: "info" },
  submitting: { label: "Sending…", tone: "progress" },
  uncertain: { label: "Uncertain (will be checked before any new attempt)", tone: "warning" },
  failed: { label: "Failed", tone: "error" },
  pending: { label: "Pending", tone: "neutral" },
};

/** The account the post goes to: `@profile`, else `@` + what follows the colon of the target, else the channel name. */
function accountOf(p: { target: string; channelProfile?: string; channelName?: string }): string | undefined {
  if (p.channelProfile) return `@${p.channelProfile}`;
  const colon = p.target.indexOf(":");
  if (colon >= 0) return `@${p.target.slice(colon + 1)}`;
  return p.channelName;
}

/**
 * Every Publication of a Mission (ADR-069): the channel, its status, the link
 * to the post (on the network, and in the Publisher's UI), the scheduled date.
 * The errors are listed apart, and a `failed` one can be retried on its own.
 * A failed `publish.onPublished` call is a warning with a resend button.
 */
export function PublicationList({ missionId, title }: { missionId: string; title?: string }) {
  const publications = useQuery(api.publications.listForMission, { missionId: missionId as Id<"missions"> });
  const retryPublication = useAction(api.publisher_node.retryPublication);
  const resendNotification = useAction(api.publication_notify_node.resendPublishedNotification);
  const [retrying, setRetrying] = useState<string | null>(null);
  const [resending, setResending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resendError, setResendError] = useState<string | null>(null);

  if (!publications || publications.length === 0) return null;

  async function retry(publicationId: Id<"publications">) {
    setError(null);
    setRetrying(publicationId);
    try {
      await retryPublication({ publicationId });
    } catch (err) {
      const message = extractConvexErrorMessage(err, "Could not retry the Publication");
      // A failed attempt is already recorded on the Publication and shown in "Errors".
      setError(message.includes("Publishing failed:") ? null : message);
    } finally {
      setRetrying(null);
    }
  }

  async function resend(publicationId: Id<"publications">) {
    setResendError(null);
    setResending(publicationId);
    try {
      await resendNotification({ publicationId });
    } catch (err) {
      // A call that fails is recorded on the Publication (its warning shows it); this is anything else.
      setResendError(extractConvexErrorMessage(err, "Could not resend the call"));
    } finally {
      setResending(null);
    }
  }

  const problems = publications.filter((p) => p.status === "failed" || p.status === "uncertain" || p.error);
  // A published Publication whose `publish.onPublished` call failed (ADR-074): a warning, never an error.
  const unnotified = publications.flatMap((p) =>
    p.status === "published" && p.notification?.status === "failed" ? [{ ...p, notification: p.notification }] : [],
  );

  const body = (
    <div className={title ? "grid gap-4" : "grid gap-4 border-t border-border pt-4"} data-testid="publications">
      <div className="flex items-center gap-2">
        <Layers aria-hidden="true" className="size-5 text-muted-foreground" />
        {title ? (
          <h2 className="m-0 text-lg font-semibold text-foreground">{title}</h2>
        ) : (
          <h3 className="m-0 text-base font-semibold text-foreground">Publications</h3>
        )}
      </div>
      <ul className="m-0 mt-1 grid list-none gap-4 p-0 text-sm">
        {publications.map((publication) => {
          const status = STATUS[publication.status] ?? { label: publication.status, tone: "neutral" as const };
          return (
            <li
              key={publication.id}
              data-testid={`publication-${publication.target}`}
              className="grid gap-4 py-1"
            >
              <div className="flex items-center gap-3">
                <PlatformLogo adapter={publication.publisherAdapter} service={publication.channelService} className="size-8" />
                <div className="grid min-w-0 flex-1 gap-0.5">
                  <span className="truncate font-semibold text-foreground">
                    {publication.channelService ? platformName(publication.channelService) : publication.target}
                  </span>
                  <span className="truncate text-muted-foreground">
                    {accountOf(publication)}
                    {!publication.externalUrl && publication.externalId && ` · id ${publication.externalId}`}
                    {publication.scheduledAt !== undefined && ` · ${new Date(publication.scheduledAt).toLocaleString()}`}
                  </span>
                </div>
                <StatusBadge tone={status.tone} label={status.label} className="shrink-0" />
              </div>
              <span className="flex flex-wrap gap-2 empty:hidden">
                {publication.managerUrl && (
                  <a
                    href={publication.managerUrl}
                    target="_blank"
                    rel="noreferrer"
                    className={cn(buttonVariants({ size: "sm", variant: "outline" }), "flex-1 justify-center")}
                  >
                    <ExternalLink aria-hidden="true" />
                    Open in {publication.managerName ?? "the Publisher"}
                  </a>
                )}
                {publication.externalUrl && (
                  <a
                    href={publication.externalUrl}
                    target="_blank"
                    rel="noreferrer"
                    className={cn(buttonVariants({ size: "sm", variant: "outline" }), "flex-1 justify-center")}
                  >
                    <ExternalLink aria-hidden="true" />
                    View post
                  </a>
                )}
              </span>
            </li>
          );
        })}
      </ul>
      {unnotified.length > 0 && (
        <section data-testid="publication-notifications" className="grid gap-3 border-t border-border pt-4">
          <ul className="m-0 grid list-none gap-3 p-0 text-sm">
            {unnotified.map((publication) => (
              <li key={publication.id} className="grid gap-2" data-testid={`publication-notification-${publication.target}`}>
                <StatusBadge tone="warning" label={`${publication.notification.service} was not notified`} className="justify-self-start" />
                {publication.notification.error && (
                  <p className="m-0 text-muted-foreground">{publication.notification.error}</p>
                )}
                <div>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={resending !== null}
                    onClick={() => void resend(publication.id)}
                  >
                    {resending === publication.id ? "Resending…" : `Notify ${publication.notification.service} again`}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
          {resendError && <p className="m-0 text-sm text-destructive">{resendError}</p>}
        </section>
      )}
      {problems.length > 0 && (
        <section data-testid="publication-errors" className="grid gap-3 border-t border-border pt-4">
          <h3 className="m-0 text-sm font-semibold text-destructive">Errors</h3>
          <ul className="m-0 grid list-none gap-3 p-0 text-sm">
            {problems.map((publication) => (
              <li key={publication.id} className="grid gap-2" data-testid={`publication-error-${publication.target}`}>
                <p className="m-0 text-destructive">
                  <span className="font-semibold">{publication.target}</span>
                  {publication.error ? `: ${publication.error}` : ""}
                </p>
                <div>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={retrying !== null}
                    onClick={() => void retry(publication.id)}
                  >
                    {retrying === publication.id ? "Retrying…" : publication.status === "uncertain" ? "Check and retry" : "Retry"}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
          {error && <p className="m-0 text-sm text-destructive">{error}</p>}
        </section>
      )}
    </div>
  );
  return title ? <Card className="grid gap-4 p-6">{body}</Card> : body;
}
