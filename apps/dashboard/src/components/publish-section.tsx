"use client";

import Link from "next/link";
import { useState } from "react";
import { useMutation } from "convex/react";
import { PublicationList } from "@/src/components/publication-list";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { Calendar, Send } from "lucide-react";
import { Card } from "@/components/ui/card";
import { PlatformLogo, platformName } from "@/src/components/platform-logo";
import { AutoPublishToggle, type AutoPublishControl } from "@/src/components/auto-publish-toggle";
import { useInstalledPublishers } from "@/src/hooks/use-installed-publishers";
import { unschedulablePublisherName, useProjectChannels } from "@/src/hooks/use-project-channels";
import { CapabilityWarning, ChannelSelect, accountLabel, channelCapability } from "@/src/components/publish-channel-picker";
import { DateTimePicker, formatDateTime } from "@/src/components/date-time-picker";
import { UnschedulableDate } from "@/src/components/unschedulable-date";

/**
 * Where a Mission will be published (ADR-069): the channels of the Project's
 * Publishers (editable by the reviewer), a pointer to the Publishers page when
 * one is not configured, and the status of each Publication.
 */

export type PublishProjection = {
  /** Every target the Mission goes to (one Publication each). */
  targets: string[];
  /** Every target is mapped to a channel. */
  mapped: boolean;
  unmappedTargets: string[];
  /** Every Publisher the chosen channels are on has an API key. */
  publisherReady: boolean;
  /** The platforms the Mission type publishes to; absent = every channel. */
  platforms?: string[];
  /** The platforms the content was made for (per-platform variants only); absent = any. */
  madeFor?: string[];
  /** The date the reviewer chose (epoch ms); absent = publish immediately. */
  publishAt?: number;
  publications: Array<{
    target: string;
    status: "pending" | "submitting" | "uncertain" | "scheduled" | "published" | "failed";
    externalId?: string;
    externalUrl?: string;
    scheduledAt?: number;
    error?: string;
  }>;
};

export function PublishSection({
  missionId,
  instanceId,
  publish,
  editable,
  done,
  kind,
  autoPublish,
}: {
  missionId: string;
  instanceId: string;
  publish: PublishProjection;
  /** The channels and the date can be changed (the "To publish" step); otherwise a read-only summary. */
  editable: boolean;
  /** The Mission is done: the Publications say it all, so the summary of where it goes is left out. */
  done?: boolean;
  /** The kind of the Publishable under review. */
  kind?: string;
  /** Auto-publish of the Mission, when its Template supports it (changeable only until the Run finishes). */
  autoPublish?: AutoPublishControl;
}) {
  const setPublishTargets = useMutation(api.publications.setTargets);
  const project = useProjectChannels(instanceId);
  const installed = useInstalledPublishers();
  const setPublishAt = useMutation(api.publications.setPublishAt);
  const [error, setError] = useState<string | null>(null);

  // The projection is fetched once, so the date is held locally after the first edit.
  const [publishAtMs, setPublishAtMs] = useState<number | undefined>(publish.publishAt);

  async function changePublishAt(at: number | undefined) {
    setError(null);
    const previous = publishAtMs;
    setPublishAtMs(at);
    try {
      await setPublishAt({ missionId: missionId as Id<"missions">, publishAt: at ?? null });
    } catch (err) {
      setPublishAtMs(previous);
      setError(err instanceof Error ? err.message : "Could not change the publication date");
    }
  }

  // Held locally after the first edit, like the date (the projection is fetched once).
  const [targets, setTargets] = useState(publish.targets);

  async function changeTargets(next: string[]) {
    if (next.length === 0) {
      setError("Choose at least one channel");
      return;
    }
    setError(null);
    const previous = targets;
    setTargets(next);
    try {
      await setPublishTargets({ missionId: missionId as Id<"missions">, targets: next });
    } catch (err) {
      setTargets(previous);
      setError(err instanceof Error ? err.message : "Could not change the channels");
    }
  }

  const unmapped = publish.unmappedTargets.filter((t) => targets.includes(t));

  if (done && publish.publications.length > 0) return <PublicationList missionId={missionId} title="Publications" />;

  const hasDate = publishAtMs !== undefined && Number.isFinite(publishAtMs);
  // A chosen channel on a Publisher that cannot schedule (ADR-074): no date to pick.
  const unschedulable = project ? unschedulablePublisherName(project.channels, installed, targets) : undefined;
  const formattedDate = hasDate ? formatDateTime(publishAtMs) : "Immediately";

  return (
    <Card className="grid gap-4 p-6" data-testid="publish-section">
      <h2 className="m-0 flex items-center gap-2 text-lg font-semibold text-foreground">
        <Send aria-hidden="true" className="size-5 text-muted-foreground" />
        Publishing
      </h2>
      {editable ? (
        <div className="grid gap-2">
          <span className="text-sm font-semibold text-muted-foreground">Channels</span>
          {project ? (
            <ChannelSelect
              channels={project.channels}
              kind={kind}
              platforms={publish.platforms}
              madeFor={publish.madeFor}
              selected={targets}
              disabled={!editable}
              onChange={(next) => { void changeTargets(next); }}
            />
          ) : null}
          <p data-testid="publish-summary" className="m-0 text-sm text-muted-foreground">
            {targets.length === 0 ? "Choose a channel. " : `Goes to ${targets.join(", ")} `}
            {hasDate ? `on ${formattedDate}` : "immediately"}.
          </p>
          <span className="mt-2 text-sm font-semibold text-muted-foreground">Publish at</span>
          {unschedulable && !hasDate ? (
            <UnschedulableDate publisher={unschedulable}>
              <DateTimePicker value={undefined} disabled onChange={() => {}} onError={setError} />
            </UnschedulableDate>
          ) : (
            <>
              <DateTimePicker value={publishAtMs} onChange={(at) => { void changePublishAt(at); }} onError={setError} />
              {unschedulable ? (
                <p data-testid="publish-at-unschedulable" className="m-0 text-sm text-destructive">
                  {unschedulable} cannot schedule a post: clear the date to publish.
                </p>
              ) : null}
            </>
          )}
        </div>
      ) : (
        <dl data-testid="publish-readonly" className="m-0 grid gap-2 text-sm">
          {targets.map((target) => {
            const channel = project?.channels.find((c) => c.target === target);
            const capabilities = installed?.find((p) => p.adapter === channel?.adapter)?.capabilities;
            const capability = channel ? channelCapability(capabilities, channel, kind, publish.platforms, publish.madeFor) : undefined;
            return (
              <div key={target} data-testid={`publish-row-${target}`} className="flex items-center gap-3 border-b border-border pb-2 last:border-0">
                <PlatformLogo
                  adapter={channel?.adapter}
                  service={channel?.mapped ? channel.channelService : undefined}
                  className="size-8"
                />
                <span className="flex-1 font-medium text-foreground">
                  {channel?.mapped && channel.channelService ? platformName(channel.channelService) : target}
                  {channel?.mapped ? (
                    <span className="font-normal text-muted-foreground"> · {accountLabel(channel)}</span>
                  ) : null}
                </span>
                {capability ? <CapabilityWarning capability={capability} testId={`publish-row-warning-${target}`} /> : null}
              </div>
            );
          })}
          {targets.length === 0 && <p className="m-0 text-muted-foreground">No channel chosen.</p>}
        </dl>
      )}
      <div className="grid gap-4 border-t border-border pt-4 text-sm">
        {autoPublish && (
          <div className="flex items-center gap-3">
            {autoPublish.editable ? (
              <AutoPublishToggle checked={autoPublish.checked} onChange={autoPublish.onChange} hint={autoPublish.hint} />
            ) : (
              <>
                <span className="flex-1 text-muted-foreground">Auto-publish</span>
                <span data-testid="publish-auto" className="text-foreground">{autoPublish.checked ? "On" : "Off"}</span>
              </>
            )}
          </div>
        )}
        {!editable && (
          <div className="flex items-center gap-3">
            <Calendar aria-hidden="true" className="size-4 text-muted-foreground" />
            <span className="flex-1 text-muted-foreground">Publish at</span>
            <span data-testid="publish-at-readonly" className="text-foreground">{formattedDate}</span>
          </div>
        )}
      </div>
      {error && <p className="m-0 text-sm text-destructive">{error}</p>}
      {(unmapped.length > 0 || !publish.publisherReady) && (
        <p data-testid="publish-unmapped" className="m-0 text-sm text-destructive">
          {!publish.publisherReady
            ? "A Publisher of these channels has no API key, so publishing is disabled."
            : `Not on the Project's Publishers or not configured: ${unmapped.join(", ")}. Publishing is disabled.`}{" "}
          <Link href={`/projects/${encodeURIComponent(instanceId)}/publishers`} className="underline">
            Open the Publishers page
          </Link>
        </p>
      )}
      <PublicationList missionId={missionId} />
    </Card>
  );
}
