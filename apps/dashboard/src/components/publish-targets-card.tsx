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
import { NativeSelect } from "@/components/ui/native-select";
import { optionsOfPlatform } from "@opengroow/publisher-sdk";
import { useInstalledPublisher } from "@/src/hooks/use-installed-publishers";
import { StatusBadge } from "@/components/opengroow/status-badge";
import { PlatformLogo, platformName } from "@/src/components/platform-logo";
import { useStoreMissingHandles } from "@/src/hooks/use-store-missing-handles";

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
  const listChannels = useAction(api.publishers_node.listChannels);
  const channelOptions = useInstalledPublisher(publisher.adapter)?.channelOptions;

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

  async function handleOption(current: Extract<Target, { mapped: true }>, key: string, value: unknown) {
    const { [key]: _previous, ...others } = (current.settings ?? {}) as Record<string, unknown>;
    const empty = value === "" || value === undefined;
    setError("");
    try {
      await updateSettings({
        instanceId: id,
        target: current.target,
        settings: empty ? others : { ...others, [key]: value },
      });
    } catch (e) {
      setError(errorMessage(e, "Option could not be saved"));
    }
  }

  // Entries added before the handle was stored get it from the live channel list.
  const profileOf = (t: Target) =>
    t.mapped ? (t.channelProfile ?? channels?.find((c) => c.id === t.channelId)?.profile) : undefined;

  // Entries added before handles were kept get theirs stored from the live list.
  useStoreMissingHandles(id, publisher, channels);

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
          {error ? <StatusBadge tone="error" label={error} /> : null}
          <div className="grid max-h-96 gap-2 overflow-y-auto">
            {available.length === 0 ? (
              <p className="m-0 text-sm text-muted-foreground">Every channel of your Postiz account is already added.</p>
            ) : (
              available.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className="flex items-center gap-3 rounded-lg border border-border p-3 text-left hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={!c.profile}
                  onClick={() => void handleAdd(c)}
                >
                  <PlatformLogo baseUrl={publisher.url} service={c.service} />
                  <span className="grid">
                    <span className="font-medium">{platformName(c.service)}</span>
                    <span className="text-sm text-muted-foreground">
                      {c.profile ? `@${c.profile}` : c.name}
                    </span>
                    {c.profile ? null : (
                      <span className="text-xs text-muted-foreground">This channel has no handle, so it cannot be added.</span>
                    )}
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
            const options = t.mapped && channelOptions ? optionsOfPlatform(channelOptions, t.channelService) : [];
            const expandable = options.length > 0;
            const expanded = expandable && open === t.target;
            const header = (
              <>
                <PlatformLogo baseUrl={publisher.url} service={t.mapped ? t.channelService : undefined} />
                <span className="grid flex-1 gap-1">
                  <span className="text-base font-medium">
                    {t.mapped && t.channelService ? platformName(t.channelService) : t.target}
                  </span>
                  {t.mapped ? (
                    <span className="text-sm text-muted-foreground">
                      {profileOf(t) ? `@${profileOf(t)}` : (t.channelName ?? t.channelId)}
                    </span>
                  ) : (
                    <StatusBadge tone="warning" label="Not mapped" />
                  )}
                </span>
                {expandable ? (
                  <ChevronDown className={expanded ? "rotate-180 transition-transform" : "transition-transform"} aria-hidden="true" />
                ) : null}
              </>
            );
            return (
              <li key={t.target} className="rounded-xl border border-border">
                <div className="flex items-center gap-2 pr-3">
                  {expandable ? (
                    <button
                      type="button"
                      aria-expanded={expanded}
                      className="flex min-w-0 flex-1 items-center gap-4 p-4 text-left"
                      onClick={() => setOpen(expanded ? null : t.target)}
                    >
                      {header}
                    </button>
                  ) : (
                    <div className="flex min-w-0 flex-1 items-center gap-4 p-4">{header}</div>
                  )}
                  <Button
                    type="button"
                    variant="ghost"
                    aria-label={`Remove ${t.mapped && t.channelName ? t.channelName : t.target}`}
                    onClick={() => void removeTarget({ instanceId: id, target: t.target })}
                  >
                    <Trash2 aria-hidden="true" />
                  </Button>
                </div>
                {expanded && t.mapped ? (
                  <div className="grid gap-4 border-t border-border p-4 md:grid-cols-2">
                    {options.map((option) => {
                      const stored = t.settings?.[option.key];
                      const fieldId = `${option.key}-${t.target}`;
                      if (option.type === "select") {
                        return (
                          <div key={option.key} className="grid gap-2">
                            <Label htmlFor={fieldId}>{option.label}</Label>
                            <NativeSelect
                              id={fieldId}
                              value={typeof stored === "string" ? stored : option.default}
                              onChange={(event) => void handleOption(t, option.key, event.target.value)}
                            >
                              {option.options.map((o) => (
                                <option key={o.value} value={o.value}>
                                  {o.label}
                                </option>
                              ))}
                            </NativeSelect>
                          </div>
                        );
                      }
                      if (option.type === "boolean") {
                        return (
                          <label key={option.key} className="flex items-center gap-3 text-sm">
                            <input
                              type="checkbox"
                              checked={typeof stored === "boolean" ? stored : option.default}
                              onChange={(event) => void handleOption(t, option.key, event.target.checked)}
                            />
                            {option.label}
                          </label>
                        );
                      }
                      return (
                        <div key={option.key} className="grid gap-2">
                          <Label htmlFor={fieldId}>{option.label}</Label>
                          <Input
                            id={fieldId}
                            key={String(stored ?? "")}
                            autoComplete="off"
                            placeholder={option.placeholder}
                            defaultValue={typeof stored === "string" ? stored : ""}
                            onBlur={(event) => void handleOption(t, option.key, event.target.value.trim())}
                          />
                        </div>
                      );
                    })}
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
