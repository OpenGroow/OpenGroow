"use client";

import { useCallback, useEffect, useState } from "react";
import { useAction, useMutation } from "convex/react";
import { ChevronDown, Loader2, Plus, RefreshCw, Trash2 } from "lucide-react";
import { api } from "@convex/_generated/api";
import type { FunctionReturnType } from "convex/server";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StatusBadge } from "@/components/opengroow/status-badge";

type Channel = { id: string; name: string; service: string; profile?: string; disabled?: boolean };
type Publisher = NonNullable<FunctionReturnType<typeof api.publishers.get>>;
type Target = Publisher["targets"][number];

const PLATFORM_NAMES: Record<string, string> = { tiktok: "TikTok", linkedin: "LinkedIn", youtube: "YouTube", x: "X" };

function platformName(service: string): string {
  return PLATFORM_NAMES[service] ?? service.charAt(0).toUpperCase() + service.slice(1);
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
}

/** Default Publish target name of a channel: its service, or `service:handle` when that is already taken. */
function defaultTargetName(channel: Channel, taken: Set<string>): string {
  const base = slug(channel.service) || "channel";
  if (!taken.has(base)) return base;
  const qualified = `${base}:${slug(channel.profile ?? channel.name) || channel.id.slice(0, 6)}`;
  return taken.has(qualified) ? `${qualified}-${channel.id.slice(0, 4)}` : qualified;
}

/** Postiz serves the logo of each platform next to its API (`<host>/icons/platforms/<service>.png`). */
function PlatformLogo({ baseUrl, service }: { baseUrl: string; service?: string }) {
  const [broken, setBroken] = useState(false);
  if (!service || broken) return <span className="size-10 shrink-0 rounded-lg bg-muted" aria-hidden="true" />;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`${baseUrl.replace(/\/+$/, "")}/icons/platforms/${encodeURIComponent(service)}.png`}
      alt=""
      className="size-10 shrink-0 rounded-lg object-contain"
      onError={() => setBroken(true)}
    />
  );
}

/**
 * The channels of the Project's Publisher. Adding a channel creates the logical
 * Publish target an Agent's Template refers to (ADR-069), named after the
 * service by default; the name and the service-specific settings are editable.
 */
export function PublishTargetsCard({ instanceId: id, publisher }: { instanceId: string; publisher: Publisher }) {
  const mapTarget = useMutation(api.publishers.mapTarget);
  const removeTarget = useMutation(api.publishers.removeTarget);
  const listChannels = useAction(api.publishers.listChannels);

  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [channels, setChannels] = useState<Channel[] | null>(null);
  const [picking, setPicking] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState("");

  const loadChannels = useCallback(async () => {
    setLoading(true);
    setMessage(null);
    try {
      const result = await listChannels({ instanceId: id });
      if (result.ok) setChannels(result.channels);
      else setMessage(result.error);
    } catch (e) {
      setMessage(errorMessage(e, "Channels could not be loaded"));
    } finally {
      setLoading(false);
    }
  }, [id, listChannels]);

  useEffect(() => {
    if (publisher.hasApiKey) void loadChannels();
  }, [publisher.hasApiKey, loadChannels]);

  async function save(channelId: string, channelName: string | undefined, service: string | undefined, target: string, settings?: Record<string, unknown>) {
    setError("");
    try {
      await mapTarget({ instanceId: id, target, channelId, channelName, channelService: service, settings });
      return true;
    } catch (e) {
      setError(errorMessage(e, "Publish target could not be saved"));
      return false;
    }
  }

  async function handleAdd(channel: Channel) {
    const name = defaultTargetName(channel, new Set(publisher.targets.map((t) => t.target)));
    if (await save(channel.id, channel.name, channel.service, name)) {
      setPicking(false);
      setOpen(name);
    }
  }

  async function handleRename(current: Extract<Target, { mapped: true }>, raw: string) {
    const next = raw.trim().toLowerCase();
    if (!next || next === current.target) return;
    if (await save(current.channelId, current.channelName, current.channelService, next, current.settings)) {
      await removeTarget({ instanceId: id, target: current.target });
      setOpen(next);
    }
  }

  async function handleSettings(current: Extract<Target, { mapped: true }>, raw: string) {
    let settings: Record<string, unknown> = {};
    if (raw.trim()) {
      try {
        const parsed: unknown = JSON.parse(raw);
        if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error();
        settings = parsed as Record<string, unknown>;
      } catch {
        setError(`Settings of "${current.target}" must be a JSON object`);
        return;
      }
    }
    await save(current.channelId, current.channelName, current.channelService, current.target, settings);
  }

  const taken = new Set(publisher.targets.flatMap((t) => (t.mapped ? [t.channelId] : [])));
  const available = (channels ?? []).filter((c) => !taken.has(c.id) && !c.disabled);

  return (
    <Card className="gap-4 p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="grid gap-1">
          <h2 className="m-0 text-base font-semibold">Channels</h2>
          <p className="m-0 text-sm text-muted-foreground">The list of channels available for this publisher.</p>
        </div>
        <div className="flex gap-2">
          <Button type="button" variant="ghost" aria-label="Refresh channels" disabled={loading} onClick={() => void loadChannels()}>
            {loading ? <Loader2 className="animate-spin" aria-hidden="true" /> : <RefreshCw aria-hidden="true" />}
          </Button>
          <Button type="button" variant="outline" disabled={!channels} onClick={() => setPicking((v) => !v)}>
            <Plus aria-hidden="true" />
            Add channel
          </Button>
        </div>
      </div>
      {message ? <StatusBadge tone="error" label={message} /> : null}
      {!publisher.hasApiKey ? (
        <p className="m-0 text-sm text-muted-foreground">Save the connection first to list your channels.</p>
      ) : null}

      {picking ? (
        <div className="grid gap-2 rounded-xl border border-border p-3">
          {available.length === 0 ? (
            <p className="m-0 text-sm text-muted-foreground">Every channel of your Postiz account is already added.</p>
          ) : (
            available.map((c) => (
              <button
                key={c.id}
                type="button"
                className="flex items-center gap-3 rounded-lg p-2 text-left hover:bg-muted"
                onClick={() => void handleAdd(c)}
              >
                <PlatformLogo baseUrl={publisher.url} service={c.service} />
                <span className="grid">
                  <span className="font-medium">{platformName(c.service)}</span>
                  <span className="text-sm text-muted-foreground">
                    {c.name}
                    {c.profile ? ` · @${c.profile}` : ""}
                  </span>
                </span>
              </button>
            ))
          )}
        </div>
      ) : null}

      {publisher.targets.length === 0 ? (
        <p className="m-0 text-sm text-muted-foreground">No channel added yet.</p>
      ) : (
        <ul className="m-0 grid list-none gap-3 p-0">
          {publisher.targets.map((t) => {
            const expanded = open === t.target;
            return (
              <li key={t.target} className="rounded-xl border border-border">
                <button
                  type="button"
                  aria-expanded={expanded}
                  className="flex w-full items-center gap-4 p-4 text-left"
                  onClick={() => setOpen(expanded ? null : t.target)}
                >
                  <PlatformLogo baseUrl={publisher.url} service={t.mapped ? t.channelService : undefined} />
                  <span className="grid flex-1 gap-1">
                    <span className="font-medium">
                      {t.mapped && t.channelService ? platformName(t.channelService) : t.target}
                    </span>
                    {t.mapped ? (
                      <span className="w-fit rounded-full border border-border px-3 py-0.5 text-sm">
                        {t.channelName ?? t.channelId}
                      </span>
                    ) : (
                      <StatusBadge tone="warning" label="Not mapped" />
                    )}
                  </span>
                  <ChevronDown className={expanded ? "rotate-180 transition-transform" : "transition-transform"} aria-hidden="true" />
                </button>
                {expanded ? (
                  <div className="grid gap-3 border-t border-border p-4 md:grid-cols-[1fr_2fr_auto] md:items-end">
                    <div className="grid gap-2">
                      <Label htmlFor={`target-${t.target}`}>Publish target name</Label>
                      <Input
                        id={`target-${t.target}`}
                        autoComplete="off"
                        defaultValue={t.target}
                        disabled={!t.mapped}
                        onBlur={(event) => t.mapped && void handleRename(t, event.target.value)}
                      />
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor={`settings-${t.target}`}>Settings (JSON)</Label>
                      <Input
                        id={`settings-${t.target}`}
                        key={JSON.stringify(t.mapped ? t.settings ?? {} : {})}
                        autoComplete="off"
                        disabled={!t.mapped}
                        placeholder='{"board": "recipes"}'
                        defaultValue={t.mapped && t.settings ? JSON.stringify(t.settings) : ""}
                        onBlur={(event) => t.mapped && void handleSettings(t, event.target.value)}
                      />
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      aria-label={`Remove ${t.target}`}
                      onClick={() => void removeTarget({ instanceId: id, target: t.target })}
                    >
                      <Trash2 aria-hidden="true" />
                    </Button>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {error ? (
        <p className="m-0 text-sm text-destructive" aria-live="polite">
          {error}
        </p>
      ) : null}
    </Card>
  );
}
