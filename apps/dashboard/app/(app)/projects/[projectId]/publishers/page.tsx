"use client";

import { useCallback, useEffect, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { Eye, EyeOff, KeyRound, Layers, Link2, Loader2, Plug, Save, Settings } from "lucide-react";
import { api } from "@convex/_generated/api";
import type { InstanceRecord } from "@/src/components/instance-workspace.types";
import { findInstanceById } from "@/src/components/instance-workspace.utils";
import { useAuthenticatedInstances } from "@/src/hooks/use-authenticated-instances";
import { useResolvedProjectId } from "@/src/hooks/use-resolved-project-id";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PublishTargetsCard } from "@/src/components/publish-targets-card";
import { StatusBadge } from "@/components/opengroow/status-badge";

type PublishersPageProps = {
  params: Promise<{ projectId: string }>;
};

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
  const testConnection = useAction(api.publishers.testConnection);

  const [url, setUrl] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [tab, setTab] = useState<"configuration" | "channels">("configuration");
  const [showKey, setShowKey] = useState(false);
  const [connected, setConnected] = useState<boolean | null>(null);
  const [busy, setBusy] = useState<"save" | "test" | null>(null);
  const [message, setMessage] = useState<{ tone: "active" | "error"; text: string } | null>(null);

  const checkConnection = useCallback(async () => {
    if (!instanceId) return;
    try {
      const result = await testConnection({ instanceId });
      setConnected(result.ok);
    } catch {
      setConnected(false);
    }
  }, [instanceId, testConnection]);

  const hasApiKey = publisher?.hasApiKey ?? false;
  useEffect(() => {
    if (hasApiKey) void checkConnection();
    else setConnected(null);
  }, [hasApiKey, checkConnection]);

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
      void checkConnection();
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
      setConnected(result.ok);
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

  const tabClass = (active: boolean) =>
    `flex items-center gap-2 border-b-2 px-4 pb-3 text-sm font-medium ${
      active ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
    }`;

  return (
    <div className="grid gap-6">
      <header className="grid gap-4">
        <div className="flex items-center gap-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/postiz.png" alt="" className="size-14 rounded-xl object-contain" />
          <div className="grid gap-1">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="m-0 text-2xl font-semibold">Postiz</h1>
              {connected === true ? <StatusBadge tone="active" label="Connected" /> : null}
              {connected === false ? <StatusBadge tone="error" label="Not connected" /> : null}
              {publisher && !publisher.hasApiKey ? <StatusBadge tone="warning" label="API key missing" /> : null}
            </div>
            <p className="m-0 text-sm text-muted-foreground">Social media scheduler &amp; publisher</p>
          </div>
        </div>
        <div className="flex gap-2 border-b border-border" role="tablist">
          <button type="button" role="tab" aria-selected={tab === "configuration"} className={tabClass(tab === "configuration")} onClick={() => setTab("configuration")}>
            <Settings className="size-4" aria-hidden="true" />
            Configuration
          </button>
          <button type="button" role="tab" aria-selected={tab === "channels"} className={tabClass(tab === "channels")} onClick={() => setTab("channels")}>
            <Layers className="size-4" aria-hidden="true" />
            Channels{publisher ? ` (${publisher.targets.length})` : ""}
          </button>
        </div>
      </header>

      {tab === "configuration" ? (
        <Card className="gap-4 p-5">
          <h2 className="m-0 text-base font-semibold">Connection</h2>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="publisher-url">Postiz URL</Label>
              <div className="relative">
                <Link2 className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                <Input
                  id="publisher-url"
                  name="url"
                  className="pl-9"
                  autoComplete="off"
                  placeholder="https://postiz.example.com"
                  value={urlValue}
                  onChange={(event) => setUrl(event.target.value)}
                />
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="publisher-api-key">API key</Label>
              <div className="relative">
                <KeyRound className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                <Input
                  id="publisher-api-key"
                  name="apiKey"
                  className="px-9"
                  type={showKey ? "text" : "password"}
                  autoComplete="off"
                  placeholder={publisher?.hasApiKey ? "Saved. Type to replace it" : "Postiz API key"}
                  value={apiKey}
                  onChange={(event) => setApiKey(event.target.value)}
                />
                <button
                  type="button"
                  aria-label={showKey ? "Hide API key" : "Show API key"}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  onClick={() => setShowKey((v) => !v)}
                >
                  {showKey ? <EyeOff className="size-4" aria-hidden="true" /> : <Eye className="size-4" aria-hidden="true" />}
                </button>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" size="lg" disabled={!urlValue.trim() || busy !== null} onClick={() => void handleSave()}>
              {busy === "save" ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Save aria-hidden="true" />}
              Save changes
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
      ) : publisher ? (
        <PublishTargetsCard instanceId={id} publisher={publisher} />
      ) : (
        <Card className="p-5 text-sm text-muted-foreground">Save the connection first to list your channels.</Card>
      )}
    </div>
  );
}
