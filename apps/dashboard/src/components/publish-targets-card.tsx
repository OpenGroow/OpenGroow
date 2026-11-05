"use client";

import { useCallback, useEffect, useState } from "react";
import { useAction, useMutation } from "convex/react";
import { Loader2, RefreshCw } from "lucide-react";
import { api } from "@convex/_generated/api";
import type { FunctionReturnType } from "convex/server";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StatusBadge } from "@/components/opengroow/status-badge";

type Channel = { id: string; name: string; service: string; picture?: string; profile?: string; disabled?: boolean };
type Publisher = NonNullable<FunctionReturnType<typeof api.publishers.get>>;
type Target = Publisher["targets"][number];

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
}

/** Default Publish target name of a channel: its service, or `service:profile` when that is already taken. */
function defaultTargetName(channel: Channel, taken: Set<string>): string {
  const base = slug(channel.service) || "channel";
  if (!taken.has(base)) return base;
  const qualified = `${base}:${slug(channel.profile ?? channel.name) || channel.id.slice(0, 6)}`;
  return taken.has(qualified) ? `${qualified}-${channel.id.slice(0, 4)}` : qualified;
}

/**
 * The channels of the Project's Publisher. Enabling a channel creates the
 * logical Publish target an Agent's Template refers to (ADR-069); the target
 * is named after the service and can be renamed.
 */
export function PublishTargetsCard({ instanceId: id, publisher }: { instanceId: string; publisher: Publisher }) {
  const mapTarget = useMutation(api.publishers.mapTarget);
  const removeTarget = useMutation(api.publishers.removeTarget);
  const listChannels = useAction(api.publishers.listChannels);

  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [channels, setChannels] = useState<Channel[] | null>(null);
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

  const targetOf = (channelId: string): Target | undefined =>
    publisher.targets.find((t) => t.mapped && t.channelId === channelId);

  async function save(channel: Channel, target: string, settings?: Record<string, unknown>): Promise<boolean> {
    setError("");
    try {
      await mapTarget({
        instanceId: id,
        target,
        channelId: channel.id,
        channelName: channel.name,
        channelService: channel.service,
        settings,
      });
      return true;
    } catch (e) {
      setError(errorMessage(e, "Publish target could not be saved"));
      return false;
    }
  }

  async function handleToggle(channel: Channel, enabled: boolean) {
    const current = targetOf(channel.id);
    if (!enabled) {
      if (current) await removeTarget({ instanceId: id, target: current.target });
      return;
    }
    if (current) return;
    await save(channel, defaultTargetName(channel, new Set(publisher.targets.map((t) => t.target))));
  }

  async function handleRename(channel: Channel, current: Target, raw: string) {
    const next = raw.trim().toLowerCase();
    if (!next || next === current.target || !current.mapped) return;
    if (await save(channel, next, current.settings)) await removeTarget({ instanceId: id, target: current.target });
  }

  async function handleSettings(channel: Channel, current: Target, raw: string) {
    if (!current.mapped) return;
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
    await save(channel, current.target, settings);
  }

  const orphans = publisher.targets.filter((t) => !t.mapped || !channels?.some((c) => c.id === t.channelId));

  return (
    <Card className="gap-4 p-5">
      <div className="flex items-center justify-between gap-4">
        <h2 className="m-0 text-base font-semibold">Channels</h2>
        <Button type="button" variant="outline" disabled={loading} onClick={() => void loadChannels()}>
          {loading ? <Loader2 className="animate-spin" aria-hidden="true" /> : <RefreshCw aria-hidden="true" />}
          Refresh channels
        </Button>
      </div>
      <p className="m-0 text-sm text-muted-foreground">
        Enable the channels of your Postiz account that Agents may publish to. Each enabled channel becomes a Publish
        target, such as <code>instagram</code> or <code>pinterest:recipes</code>, which is the name Templates refer to.
        Rename it if you have several channels on the same service.
      </p>
      {message ? <StatusBadge tone="error" label={message} /> : null}
      {!publisher.hasApiKey ? (
        <p className="m-0 text-sm text-muted-foreground">Save the connection first to list your channels.</p>
      ) : null}

      {channels && channels.length === 0 ? (
        <p className="m-0 text-sm text-muted-foreground">Your Postiz account has no channel yet.</p>
      ) : null}

      <ul className="m-0 grid list-none gap-3 p-0">
        {(channels ?? []).map((channel) => {
          const current = targetOf(channel.id);
          return (
            <li
              key={channel.id}
              className="grid gap-3 rounded-xl border border-border p-4 md:grid-cols-[auto_1fr_1fr_1fr] md:items-center"
            >
              <label className="flex items-center gap-3">
                <input
                  type="checkbox"
                  aria-label={`Enable ${channel.name}`}
                  checked={Boolean(current)}
                  disabled={channel.disabled}
                  onChange={(event) => void handleToggle(channel, event.target.checked)}
                />
                {channel.picture ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={channel.picture} alt="" className="size-10 rounded-full object-cover" />
                ) : (
                  <span className="size-10 rounded-full bg-muted" aria-hidden="true" />
                )}
              </label>
              <div className="grid gap-1">
                <span className="font-medium">{channel.name}</span>
                <span className="text-sm text-muted-foreground">
                  {channel.service}
                  {channel.profile ? ` · @${channel.profile}` : ""}
                  {channel.disabled ? " · disabled in Postiz" : ""}
                </span>
              </div>
              {current && current.mapped ? (
                <>
                  <div className="grid gap-2">
                    <Label htmlFor={`target-${channel.id}`}>Publish target</Label>
                    <Input
                      id={`target-${channel.id}`}
                      key={current.target}
                      autoComplete="off"
                      defaultValue={current.target}
                      onBlur={(event) => void handleRename(channel, current, event.target.value)}
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor={`settings-${channel.id}`}>Settings (JSON)</Label>
                    <Input
                      id={`settings-${channel.id}`}
                      key={JSON.stringify(current.settings ?? {})}
                      autoComplete="off"
                      placeholder='{"board": "recipes"}'
                      defaultValue={current.settings ? JSON.stringify(current.settings) : ""}
                      onBlur={(event) => void handleSettings(channel, current, event.target.value)}
                    />
                  </div>
                </>
              ) : (
                <span className="text-sm text-muted-foreground md:col-span-2">Not enabled</span>
              )}
            </li>
          );
        })}
      </ul>

      {channels && orphans.length > 0 ? (
        <div className="grid gap-2">
          <h3 className="m-0 text-sm font-medium">Other Publish targets</h3>
          <ul className="m-0 grid list-none gap-2 p-0">
            {orphans.map((t) => (
              <li key={t.target} className="flex items-center justify-between gap-3 text-sm">
                <span>
                  {t.target}{" "}
                  <span className="text-muted-foreground">
                    {t.mapped ? `(${t.channelName ?? t.channelId}, no longer in Postiz)` : "(no channel)"}
                  </span>
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  aria-label={`Remove ${t.target}`}
                  onClick={() => void removeTarget({ instanceId: id, target: t.target })}
                >
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {error ? (
        <p className="m-0 text-sm text-destructive" aria-live="polite">
          {error}
        </p>
      ) : null}
    </Card>
  );
}
