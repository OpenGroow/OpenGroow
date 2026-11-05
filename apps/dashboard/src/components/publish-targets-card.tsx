"use client";

import { useCallback, useEffect, useState } from "react";
import { useAction, useMutation } from "convex/react";
import { ChevronDown, Loader2, Plus, RefreshCw, Trash2 } from "lucide-react";
import { api } from "@convex/_generated/api";
import type { FunctionReturnType } from "convex/server";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StatusBadge } from "@/components/opengroow/status-badge";
import { PlatformLogo, platformName } from "@/src/components/platform-logo";

type Channel = { id: string; name: string; service: string; profile?: string; disabled?: boolean };
type Publisher = NonNullable<FunctionReturnType<typeof api.publishers.get>>;
type Target = Publisher["targets"][number];

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

/**
 * The channels of the Project's Publisher (ADR-069). Adding a channel gives it
 * a generated key; Missions and Schedules pick channels from this list. The
 * service-specific settings of each channel are editable.
 */
export function PublishTargetsCard({ instanceId: id, publisher }: { instanceId: string; publisher: Publisher }) {
  const addChannel = useMutation(api.publishers.addChannel);
  const updateSettings = useMutation(api.publishers.updateSettings);
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

  async function handleAdd(channel: Channel) {
    setError("");
    try {
      const key = await addChannel({
        instanceId: id,
        channelId: channel.id,
        channelName: channel.name,
        channelService: channel.service,
        ...(channel.profile ? { channelProfile: channel.profile } : {}),
      });
      setPicking(false);
      setOpen(key);
    } catch (e) {
      setError(errorMessage(e, "Channel could not be added"));
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
        setError("Settings must be a JSON object");
        return;
      }
    }
    setError("");
    try {
      await updateSettings({ instanceId: id, target: current.target, settings });
    } catch (e) {
      setError(errorMessage(e, "Settings could not be saved"));
    }
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

      <Dialog open={picking} onOpenChange={setPicking}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add a channel</DialogTitle>
            <DialogDescription>Choose the channel of your Postiz account to add.</DialogDescription>
          </DialogHeader>
          <div className="grid max-h-96 gap-2 overflow-y-auto">
            {available.length === 0 ? (
              <p className="m-0 text-sm text-muted-foreground">Every channel of your Postiz account is already added.</p>
            ) : (
              available.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className="flex items-center gap-3 rounded-lg border border-border p-3 text-left hover:bg-muted"
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
        </DialogContent>
      </Dialog>

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
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="w-fit rounded-full border border-border px-3 py-0.5 text-sm">
                          {t.channelName ?? t.channelId}
                        </span>
                        {t.channelProfile ? (
                          <span className="text-sm text-muted-foreground">@{t.channelProfile}</span>
                        ) : null}
                      </span>
                    ) : (
                      <StatusBadge tone="warning" label="Not mapped" />
                    )}
                  </span>
                  <ChevronDown className={expanded ? "rotate-180 transition-transform" : "transition-transform"} aria-hidden="true" />
                </button>
                {expanded ? (
                  <div className="grid gap-3 border-t border-border p-4 md:grid-cols-[1fr_auto] md:items-end">
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
                      aria-label={`Remove ${t.mapped && t.channelName ? t.channelName : t.target}`}
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
