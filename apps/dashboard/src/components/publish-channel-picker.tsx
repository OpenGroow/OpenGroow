"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { FunctionReturnType } from "convex/server";
import { PlatformLogo, platformName } from "@/src/components/platform-logo";

type Publisher = NonNullable<FunctionReturnType<typeof api.publishers.get>>;
export type PublisherChannel = Publisher["targets"][number];

/** Epoch ms to the `YYYY-MM-DDTHH:mm` local time a datetime-local input expects. */
export function toLocalInput(ms: number | undefined): string {
  if (ms === undefined) return "";
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** One channel of the Publisher as a checkbox row: logo, platform, channel name, @handle. */
export function ChannelOption({
  publisherUrl,
  channel,
  checked,
  disabled,
  onChange,
}: {
  publisherUrl: string;
  channel: PublisherChannel;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  const mapped = channel.mapped;
  return (
    <label className="flex items-center gap-3 text-sm">
      <input
        type="checkbox"
        data-testid={`publish-target-${channel.target}`}
        checked={checked}
        disabled={disabled || !mapped}
        onChange={(e) => onChange(e.target.checked)}
      />
      <PlatformLogo baseUrl={publisherUrl} service={mapped ? channel.channelService : undefined} className="size-6" />
      <span className="grid">
        <span className="font-medium">
          {mapped && channel.channelService ? platformName(channel.channelService) : channel.target}
          {mapped ? <span className="font-normal text-muted-foreground"> · {channel.channelName ?? channel.channelId}</span> : null}
        </span>
        {mapped && channel.channelProfile ? (
          <span className="text-xs text-muted-foreground">@{channel.channelProfile}</span>
        ) : null}
        {!mapped ? <span className="text-xs text-muted-foreground">Not configured</span> : null}
      </span>
    </label>
  );
}

function parsePayload(text: string): Record<string, unknown> | null {
  if (!text.trim()) return {};
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * Where a Mission type that declares `publish` sends its content (ADR-069):
 * one or several channels of the Project's Publisher and an optional date.
 * Reads and writes `publishTargets` / `publishAt` of the payload JSON, so it
 * works for any form that edits a payload as text.
 */
export function PublishChannelPicker({
  instanceId,
  payloadText,
  onChange,
}: {
  instanceId: string;
  payloadText: string;
  onChange: (payloadText: string) => void;
}) {
  const publisher = useQuery(api.publishers.get, { instanceId });
  const [dateError, setDateError] = useState<string | null>(null);
  const payload = parsePayload(payloadText);
  const selected = Array.isArray(payload?.publishTargets)
    ? (payload.publishTargets as unknown[]).filter((t): t is string => typeof t === "string")
    : [];
  const publishAt = typeof payload?.publishAt === "number" ? payload.publishAt : undefined;

  function write(patch: Record<string, unknown>) {
    if (!payload) return;
    const next: Record<string, unknown> = { ...payload, ...patch };
    for (const key of Object.keys(next)) if (next[key] === undefined) delete next[key];
    if (Array.isArray(next.publishTargets) && next.publishTargets.length === 0) delete next.publishTargets;
    onChange(Object.keys(next).length === 0 ? "" : JSON.stringify(next, null, 2));
  }

  if (publisher === undefined) return null;
  const publishersHref = `/projects/${encodeURIComponent(instanceId)}/publishers`;

  return (
    <fieldset className="grid gap-3 rounded-xl border border-border bg-card p-4" data-testid="publish-channel-picker">
      <legend className="px-1 text-sm font-semibold text-muted-foreground">Publish to</legend>
      {!publisher || publisher.targets.length === 0 ? (
        <p className="m-0 text-sm text-muted-foreground">
          No channel yet.{" "}
          <Link href={publishersHref} className="underline">
            Add one on the Publishers page
          </Link>
        </p>
      ) : (
        <div className="grid gap-2">
          {publisher.targets.map((channel) => (
            <ChannelOption
              key={channel.target}
              publisherUrl={publisher.url}
              channel={channel}
              disabled={!payload}
              checked={selected.includes(channel.target)}
              onChange={(checked) =>
                write({
                  publishTargets: checked
                    ? [...selected, channel.target]
                    : selected.filter((t) => t !== channel.target),
                })
              }
            />
          ))}
        </div>
      )}
      <label className="grid gap-1.5">
        <span className="text-xs font-semibold text-muted-foreground">Publish at (leave empty to publish immediately)</span>
        <input
          type="datetime-local"
          data-testid="publish-at"
          className="w-full max-w-xs rounded-md border border-border bg-background px-3 py-2 text-sm"
          value={toLocalInput(publishAt)}
          disabled={!payload}
          onChange={(e) => {
            const at = e.target.value === "" ? undefined : new Date(e.target.value).getTime();
            if (at !== undefined && Number.isFinite(at) && at <= Date.now()) {
              setDateError("publishAt must be in the future");
              return;
            }
            setDateError(null);
            write({ publishAt: at !== undefined && Number.isFinite(at) ? at : undefined });
          }}
        />
      </label>
      {dateError && <p data-testid="publish-at-error" className="m-0 text-sm text-destructive">{dateError}</p>}
    </fieldset>
  );
}
