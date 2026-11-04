"use client";

import { useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { Loader2, Plug, Save } from "lucide-react";
import { api } from "@convex/_generated/api";
import type { InstanceRecord } from "@/src/components/instance-workspace.types";
import { findInstanceById } from "@/src/components/instance-workspace.utils";
import { useAuthenticatedInstances } from "@/src/hooks/use-authenticated-instances";
import { useResolvedProjectId } from "@/src/hooks/use-resolved-project-id";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/opengroow/page-header";
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
  const [busy, setBusy] = useState<"save" | "test" | null>(null);
  const [message, setMessage] = useState<{ tone: "active" | "error"; text: string } | null>(null);

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

      {publisher ? <PublishTargetsCard instanceId={id} publisher={publisher} /> : null}
    </div>
  );
}
