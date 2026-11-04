"use client";

import { useState } from "react";
import { useAction, useMutation } from "convex/react";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { api } from "@convex/_generated/api";
import type { FunctionReturnType } from "convex/server";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { StatusBadge } from "@/components/opengroow/status-badge";

type Channel = { id: string; name: string; service: string; disabled?: boolean };
type Publisher = NonNullable<FunctionReturnType<typeof api.publishers.get>>;

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

/** The Publish targets of a Project's Publisher and their mapping to the service's channels (ADR-069). */
export function PublishTargetsCard({ instanceId: id, publisher }: { instanceId: string; publisher: Publisher }) {
  const addTarget = useMutation(api.publishers.addTarget);
  const mapTarget = useMutation(api.publishers.mapTarget);
  const removeTarget = useMutation(api.publishers.removeTarget);
  const listChannels = useAction(api.publishers.listChannels);

  const [loadingChannels, setLoadingChannels] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [channels, setChannels] = useState<Channel[] | null>(null);
  const [newTarget, setNewTarget] = useState("");
  const [targetError, setTargetError] = useState("");

  const unmappedCount = publisher.targets.filter((t) => !t.mapped).length;

  async function handleLoadChannels() {
    setLoadingChannels(true);
    setMessage(null);
    try {
      const result = await listChannels({ instanceId: id });
      if (result.ok) setChannels(result.channels);
      else setMessage(result.error);
    } catch (error) {
      setMessage(errorMessage(error, "Channels could not be loaded"));
    } finally {
      setLoadingChannels(false);
    }
  }

  async function handleAddTarget() {
    setTargetError("");
    try {
      await addTarget({ instanceId: id, target: newTarget });
      setNewTarget("");
    } catch (error) {
      setTargetError(errorMessage(error, "Publish target could not be added"));
    }
  }

  async function handleMap(target: string, channelId: string) {
    const channel = channels?.find((c) => c.id === channelId);
    if (!channel) return;
    const current = publisher?.targets.find((t) => t.target === target);
    await mapTarget({
      instanceId: id,
      target,
      channelId: channel.id,
      channelName: channel.name,
      channelService: channel.service,
      settings: current?.mapped ? current.settings : undefined,
    });
  }

  async function handleSettings(target: string, raw: string) {
    const current = publisher?.targets.find((t) => t.target === target);
    if (!current?.mapped) return;
    let settings: Record<string, unknown> = {};
    if (raw.trim()) {
      try {
        const parsed: unknown = JSON.parse(raw);
        if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error();
        settings = parsed as Record<string, unknown>;
      } catch {
        setTargetError(`Settings of "${target}" must be a JSON object`);
        return;
      }
    }
    setTargetError("");
    await mapTarget({
      instanceId: id,
      target,
      channelId: current.channelId,
      channelName: current.channelName,
      channelService: current.channelService,
      settings,
    });
  }

  return (
    <Card className="gap-4 p-5">
      <div className="flex items-center justify-between gap-4">
        <h2 className="m-0 text-base font-semibold">Publish targets</h2>
        <Button
          type="button"
          variant="outline"
          disabled={loadingChannels}
          onClick={() => void handleLoadChannels()}
        >
          {loadingChannels ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
          {channels ? "Refresh channels" : "Load channels"}
        </Button>
      </div>
      <p className="m-0 text-sm text-muted-foreground">
        A Publish target is the logical destination an Agent&apos;s content goes to, such as
        instagram or pinterest:recipes. Map each one to a channel of your Postiz account.
      </p>
      {unmappedCount > 0 ? (
        <p data-testid="unmapped-targets-warning" className="m-0 text-sm text-destructive" role="status">
          {unmappedCount === 1 ? "1 Publish target is not mapped" : `${unmappedCount} Publish targets are not mapped`}
          : publishing to {unmappedCount === 1 ? "it is" : "them is"} disabled until you choose a channel.
        </p>
      ) : null}
      {message ? <StatusBadge tone="error" label={message} /> : null}

      {publisher.targets.length === 0 ? (
        <p className="m-0 text-sm text-muted-foreground">No Publish target yet.</p>
      ) : (
        <ul className="m-0 grid list-none gap-3 p-0">
          {publisher.targets.map((t) => (
            <li key={t.target} className="grid gap-3 rounded-xl border border-border p-4 md:grid-cols-[1fr_1fr_1fr_auto] md:items-end">
              <div className="grid gap-2">
                <span className="font-medium">{t.target}</span>
                {t.mapped ? (
                  <StatusBadge tone="active" label={`Mapped to ${t.channelName ?? t.channelId}`} />
                ) : (
                  <StatusBadge tone="warning" label="Not mapped" />
                )}
              </div>
              <div className="grid gap-2">
                <Label htmlFor={`channel-${t.target}`}>Channel</Label>
                <NativeSelect
                  id={`channel-${t.target}`}
                  aria-label={`Channel for ${t.target}`}
                  disabled={!channels}
                  value={t.mapped ? t.channelId : ""}
                  onChange={(event) => void handleMap(t.target, event.target.value)}
                >
                  <option value="" disabled>
                    {channels ? "Choose a channel" : "Load channels first"}
                  </option>
                  {(channels ?? []).map((c) => (
                    <option key={c.id} value={c.id} disabled={c.disabled}>
                      {c.name} ({c.service})
                    </option>
                  ))}
                  {t.mapped && !channels?.some((c) => c.id === t.channelId) ? (
                    <option value={t.channelId}>{t.channelName ?? t.channelId}</option>
                  ) : null}
                </NativeSelect>
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
                  onBlur={(event) => void handleSettings(t.target, event.target.value)}
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
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-end gap-3">
        <div className="grid gap-2">
          <Label htmlFor="new-target">New Publish target</Label>
          <Input
            id="new-target"
            autoComplete="off"
            placeholder="pinterest:recipes"
            value={newTarget}
            onChange={(event) => setNewTarget(event.target.value)}
          />
        </div>
        <Button type="button" variant="outline" disabled={!newTarget.trim()} onClick={() => void handleAddTarget()}>
          <Plus aria-hidden="true" />
          Add target
        </Button>
      </div>
      {targetError ? (
        <p className="m-0 text-sm text-destructive" aria-live="polite">
          {targetError}
        </p>
      ) : null}
    </Card>
  );
}
