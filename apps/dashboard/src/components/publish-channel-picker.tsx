"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { FunctionReturnType } from "convex/server";
import { capabilityFor, matchPlatform, type CapabilitiesData, type Capability } from "@opengroow/publisher-sdk";
import { useInstalledPublisher } from "@/src/hooks/use-installed-publishers";
import { PlatformLogo, platformName } from "@/src/components/platform-logo";
import { AlertTriangle, ChevronDown } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { useStoreMissingHandles } from "@/src/hooks/use-store-missing-handles";
import { DateTimePicker } from "@/src/components/date-time-picker";
import {
  Combobox,
  ComboboxChip,
  ComboboxChips,
  ComboboxChipsInput,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxItem,
  ComboboxItemCheck,
  ComboboxList,
  ComboboxTrigger,
  ComboboxValue,
  useComboboxAnchor,
} from "@/components/ui/combobox";
import { AutoPublishToggle } from "@/src/components/auto-publish-toggle";

type Publisher = NonNullable<FunctionReturnType<typeof api.publishers.get>>;
export type PublisherChannel = Publisher["targets"][number];

/**
 * What the installed Publisher package says about a channel carrying a
 * Publishable `kind`; `supported` when no kind is known, `uncertain` when the
 * package is not installed (`capabilities` undefined).
 */
export function channelCapability(
  capabilities: CapabilitiesData | undefined,
  channel: PublisherChannel,
  kind: string | undefined,
  platforms?: readonly string[],
  madeFor?: readonly string[],
): Capability {
  if (!kind || !channel.mapped) return { level: "supported" };
  return capabilityFor(capabilities, channel.channelService, kind, platforms, madeFor);
}

/** The platforms a Mission type publishes to that no channel of the Publisher is on (empty when it is not limited). */
export function platformsWithoutChannel(publisher: Publisher, platforms: readonly string[] | undefined): string[] {
  return (platforms ?? []).filter(
    (platform) => !publisher.targets.some((channel) => channel.mapped && matchPlatform([platform], channel.channelService)),
  );
}

/**
 * What identifies a channel's account: `@handle` from the stored profile, else
 * the handle of its key (`<platform>:<handle>`, ADR-069). A channel added before
 * handles were kept has a bare key (`instagram`): no handle is invented from it,
 * the Postiz channel name is shown without an `@` until the Publishers page
 * stores the real profile.
 */
export function accountLabel(channel: PublisherChannel): string {
  if (channel.mapped && channel.channelProfile) return `@${channel.channelProfile}`;
  const colon = channel.target.indexOf(":");
  if (colon >= 0) return `@${channel.target.slice(colon + 1)}`;
  return channel.mapped ? (channel.channelName ?? channel.channelId) : channel.target;
}

/**
 * The warning icon of a channel that may not carry the kind: hover (or focus) it
 * to read why. `uncertain` is amber ("Not confirmed: ..."), `unsupported` red.
 */
export function CapabilityWarning({ capability, testId }: { capability: Capability; testId: string }) {
  if (capability.level === "supported") return null;
  const message = capability.level === "uncertain" ? `Not confirmed: ${capability.reason}` : capability.reason;
  return (
    <Tooltip>
      <TooltipTrigger
        delay={100}
        data-testid={testId}
        aria-label={message}
        render={<span tabIndex={0} className={capability.level === "unsupported" ? "text-destructive" : "text-amber-600"} />}
      >
        <AlertTriangle className="size-4" />
      </TooltipTrigger>
      <TooltipContent>{message}</TooltipContent>
    </Tooltip>
  );
}

/**
 * The channels as a multi-select (shadcn Combobox): the chosen ones as chips
 * with their @handle, a searchable list with logo, platform and handle, and a
 * Done button. Same rules as the checkbox rows: unmapped channels and channels
 * that cannot carry the kind are disabled with their reason, uncertain ones warn.
 */
export function ChannelSelect({
  publisher,
  kind,
  platforms,
  madeFor,
  selected,
  disabled,
  onChange,
}: {
  publisher: Publisher;
  kind: string | undefined;
  /** The platforms the Mission type publishes to: channels on another platform are disabled. */
  platforms?: readonly string[];
  /** The platforms the content was actually made for (per-platform variants only): channels on another one are disabled. */
  madeFor?: readonly string[];
  selected: string[];
  disabled: boolean;
  onChange: (targets: string[]) => void;
}) {
  const anchor = useComboboxAnchor();
  const capabilities = useInstalledPublisher(publisher.adapter)?.capabilities;
  const [open, setOpen] = useState(false);
  // Stable between renders: the Combobox filters on the identity of `items`.
  // Channels that cannot be used (not configured, or on a platform or a kind the Mission cannot go to) come last,
  // in the Publisher's order otherwise.
  const { byTarget, items } = useMemo(() => {
    const unusable = (channel: PublisherChannel) =>
      !channel.mapped || channelCapability(capabilities, channel, kind, platforms, madeFor).level === "unsupported";
    return {
      byTarget: new Map(publisher.targets.map((channel) => [channel.target, channel])),
      items: [...publisher.targets]
        .sort((a, b) => Number(unusable(a)) - Number(unusable(b)))
        .map((channel) => channel.target),
    };
  }, [publisher.targets, capabilities, kind, platforms, madeFor]);
  const labelOf = (target: string) => {
    const channel = byTarget.get(target);
    if (!channel) return target;
    return `${channel.mapped && channel.channelService ? platformName(channel.channelService) : ""} ${accountLabel(channel)}`.trim();
  };

  const missing = platformsWithoutChannel(publisher, platforms);

  return (
    <>
    {missing.length > 0 ? (
      <p data-testid="publish-missing-platforms" className="m-0 text-xs text-amber-600">
        This Mission type publishes to {missing.map(platformName).join(" and ")}, but this Publisher has no such channel.
      </p>
    ) : null}
    <Combobox
      multiple
      items={items}
      value={selected}
      onValueChange={(next) => onChange(next as string[])}
      open={open}
      onOpenChange={setOpen}
      itemToStringLabel={labelOf}
      disabled={disabled}
    >
      <ComboboxChips ref={anchor} data-testid="publish-channel-select">
        <ComboboxValue>
          {(values: string[]) => (
            <>
              {values.map((target) => {
                const channel = byTarget.get(target);
                return (
                  <ComboboxChip key={target} data-testid={`publish-chip-${target}`}>
                    <PlatformLogo
                      baseUrl={publisher.url}
                      service={channel?.mapped ? channel.channelService : undefined}
                      className="size-4"
                    />
                    {channel ? accountLabel(channel) : target}
                  </ComboboxChip>
                );
              })}
              <ComboboxChipsInput placeholder={values.length === 0 ? "Search channels…" : ""} />
            </>
          )}
        </ComboboxValue>
        <ComboboxTrigger aria-label="Show channels" className="ml-auto flex size-7 items-center justify-center text-muted-foreground">
          <ChevronDown />
        </ComboboxTrigger>
      </ComboboxChips>
      <ComboboxContent anchor={anchor}>
        <ComboboxEmpty>No channel found.</ComboboxEmpty>
        <ComboboxList>
          {(target: string) => {
            const channel = byTarget.get(target);
            if (!channel) return null;
            const capability = channelCapability(capabilities, channel, kind, platforms, madeFor);
            const unsupported = capability.level === "unsupported";
            const isSelected = selected.includes(target);
            return (
              <ComboboxItem
                key={target}
                value={target}
                disabled={!channel.mapped || (unsupported && !isSelected)}
                data-testid={`publish-target-${target}`}
              >
                <ComboboxItemCheck />
                <PlatformLogo baseUrl={publisher.url} service={channel.mapped ? channel.channelService : undefined} className="size-8" />
                <span className="grid flex-1">
                  <span className="font-medium">
                    {channel.mapped && channel.channelService ? platformName(channel.channelService) : channel.target}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {channel.mapped ? accountLabel(channel) : "Not configured"}
                  </span>
                  {unsupported ? (
                    <span data-testid={`publish-target-reason-${target}`} className="text-xs text-destructive">
                      {capability.reason}
                    </span>
                  ) : null}
                </span>
                {capability.level === "uncertain" ? (
                  <CapabilityWarning capability={capability} testId={`publish-target-warning-${target}`} />
                ) : null}
              </ComboboxItem>
            );
          }}
        </ComboboxList>
        <div className="flex justify-end border-t border-border p-2">
          <Button size="sm" type="button" onClick={() => setOpen(false)}>
            Done
          </Button>
        </div>
      </ComboboxContent>
    </Combobox>
    </>
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
  kind,
  platforms,
  onChange,
  autoPublish,
}: {
  instanceId: string;
  payloadText: string;
  /** When given, the Auto-publish toggle sits in this card next to the date, so everything about publishing is in one place. */
  autoPublish?: { checked: boolean; onChange: (next: boolean) => void; hint?: string };
  /** The Mission type's declared `publish.kind`: channels that cannot carry it are disabled. */
  kind?: string;
  /** The Mission type's declared `publish.platforms`: channels on another platform are disabled. */
  platforms?: readonly string[];
  onChange: (payloadText: string) => void;
}) {
  const publisher = useQuery(api.publishers.get, { instanceId });
  useStoreMissingHandles(instanceId, publisher);
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
    <fieldset className="grid gap-3 rounded-xl border border-border p-4" data-testid="publish-channel-picker">
      <legend className="px-1 text-sm font-semibold text-muted-foreground">Publish</legend>
      <p className="m-0 text-xs text-muted-foreground">Channels</p>
      {!publisher || publisher.targets.length === 0 ? (
        <p className="m-0 text-sm text-muted-foreground">
          No channel yet.{" "}
          <Link href={publishersHref} className="underline">
            Add one on the Publishers page
          </Link>
        </p>
      ) : (
        <ChannelSelect
          publisher={publisher}
          kind={kind}
          platforms={platforms}
          selected={selected}
          disabled={!payload}
          onChange={(targets) => write({ publishTargets: targets })}
        />
      )}
      <div
        className={autoPublish ? "grid gap-4 border-t border-border pt-4 md:grid-cols-2 md:items-start" : "grid"}
        data-testid="publish-options"
      >
        {autoPublish && (
          <AutoPublishToggle checked={autoPublish.checked} onChange={autoPublish.onChange} hint={autoPublish.hint} />
        )}
        <div className="grid gap-1.5">
          <span className="text-sm font-semibold text-muted-foreground">Publish at</span>
          <DateTimePicker
            value={publishAt}
            disabled={!payload}
            onError={setDateError}
            onChange={(at) => write({ publishAt: at })}
          />
        </div>
      </div>
      {dateError && <p data-testid="publish-at-error" className="m-0 text-sm text-destructive">{dateError}</p>}
    </fieldset>
  );
}
