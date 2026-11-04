"use client";

import { useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { Loader2, Plug, Plus, Save, Trash2 } from "lucide-react";
import { api } from "@convex/_generated/api";
import type { InstanceRecord } from "@/src/components/instance-workspace.types";
import { findInstanceById } from "@/src/components/instance-workspace.utils";
import { useAuthenticatedInstances } from "@/src/hooks/use-authenticated-instances";
import { useResolvedProjectId } from "@/src/hooks/use-resolved-project-id";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { PageHeader } from "@/components/opengroow/page-header";
import { StatusBadge } from "@/components/opengroow/status-badge";

type PublishersPageProps = {
  params: Promise<{ projectId: string }>;
};

type Channel = { id: string; name: string; service: string; disabled?: boolean };

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export default function PublishersPage({ params }: PublishersPageProps) {
  const resolvedInstanceId = useResolvedProjectId(params);
  const instances = useAuthenticatedInstances<InstanceRecord>();
  const instance = findInstanceById(instances, resolvedInstanceId);
  const instanceId = instance?.openclawId;

  const publisher = useQuery(api.publishers.get, instanceId ? { instanceId } : "skip");
  const save = useMutation(api.publishers.save);
  const addTarget = useMutation(api.publishers.addTarget);
  const mapTarget = useMutation(api.publishers.mapTarget);
  const removeTarget = useMutation(api.publishers.removeTarget);
  const testConnection = useAction(api.publishers.testConnection);
  const listChannels = useAction(api.publishers.listChannels);

  const [url, setUrl] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState<"save" | "test" | "channels" | null>(null);
  const [message, setMessage] = useState<{ tone: "active" | "error"; text: string } | null>(null);
  const [channels, setChannels] = useState<Channel[] | null>(null);
  const [newTarget, setNewTarget] = useState("");
  const [targetError, setTargetError] = useState("");

  if (!instance || !instanceId) return null;
  const id = instanceId;

  const urlValue = url ?? publisher?.url ?? "";

  async function handleSave() {
    setBusy("save");
    setMessage(null);
    try {
      await save({ instanceId: id, adapter: "postiz", url: urlValue, apiKey: apiKey || undefined });
      setApiKey("");
      setUrl(null);
      setMessage({ tone: "active", text: "Connection saved" });
    } catch (error) {
      setMessage({ tone: "error", text: errorMessage(error, "Connection could not be saved") });
    } finally {
      setBusy(null);
    }
  }

  async function handleTest() {
    setBusy("test");
    setMessage(null);
    try {
      const result = await testConnection({ instanceId: id });
      setMessage(
        result.ok
          ? { tone: "active", text: "Connection works" }
          : { tone: "error", text: result.error },
      );
    } catch (error) {
      setMessage({ tone: "error", text: errorMessage(error, "Connection test failed") });
    } finally {
      setBusy(null);
    }
  }

  async function handleLoadChannels() {
    setBusy("channels");
    setMessage(null);
    try {
      const result = await listChannels({ instanceId: id });
      if (result.ok) setChannels(result.channels);
      else setMessage({ tone: "error", text: result.error });
    } catch (error) {
      setMessage({ tone: "error", text: errorMessage(error, "Channels could not be loaded") });
    } finally {
      setBusy(null);
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
      settings,
    });
  }

  return (
    <div className="grid gap-8">
      <PageHeader
        title="Publishers"
        description="Where approved content is published. Configure the service once; it serves every Agent of this project."
      />

      <Card className="gap-4 p-5">
        <div className="flex items-center justify-between gap-4">
          <h2 className="m-0 text-base font-semibold">Postiz connection</h2>
          {publisher ? (
            <StatusBadge tone={publisher.hasApiKey ? "active" : "warning"} label={publisher.hasApiKey ? "Configured" : "API key missing"} />
          ) : null}
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="grid gap-2">
            <Label htmlFor="publisher-url">Postiz URL</Label>
            <Input
              id="publisher-url"
              name="url"
              autoComplete="off"
              placeholder="https://postiz.example.com/api"
              value={urlValue}
              onChange={(event) => setUrl(event.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="publisher-api-key">API key</Label>
            <Input
              id="publisher-api-key"
              name="apiKey"
              type="password"
              autoComplete="off"
              placeholder={publisher?.hasApiKey ? "Saved. Type to replace it" : "Postiz API key"}
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
            />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" size="lg" disabled={!urlValue.trim() || busy !== null} onClick={() => void handleSave()}>
            {busy === "save" ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Save aria-hidden="true" />}
            Save
          </Button>
          <Button
            type="button"
            variant="outline"
            size="lg"
            disabled={!publisher || busy !== null}
            onClick={() => void handleTest()}
          >
            {busy === "test" ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Plug aria-hidden="true" />}
            Test connection
          </Button>
          {message ? <StatusBadge tone={message.tone} label={message.text} /> : null}
        </div>
      </Card>

      {publisher ? (
        <Card className="gap-4 p-5">
          <div className="flex items-center justify-between gap-4">
            <h2 className="m-0 text-base font-semibold">Publish targets</h2>
            <Button
              type="button"
              variant="outline"
              disabled={busy !== null}
              onClick={() => void handleLoadChannels()}
            >
              {busy === "channels" ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
              {channels ? "Refresh channels" : "Load channels"}
            </Button>
          </div>
          <p className="m-0 text-sm text-muted-foreground">
            A Publish target is the logical destination an Agent&apos;s content goes to, such as
            instagram or pinterest:recipes. Map each one to a channel of your Postiz account.
          </p>

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
      ) : null}
    </div>
  );
}
