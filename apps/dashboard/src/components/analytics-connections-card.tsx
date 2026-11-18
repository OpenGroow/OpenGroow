"use client";

import { useEffect, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { Download, Loader2, Save, Trash2 } from "lucide-react";
import { api } from "@convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { extractConvexErrorMessage } from "@/src/lib/convex-error";
import { StatusBadge } from "@/components/opengroow/status-badge";

// The connection of an Analytics Adapter, once per Project (ADR-078), set up
// like a Publisher's: a URL, an API key that is never read back, and the
// options the package declares. Without one, an adapter that belongs to a
// Publisher reads through that Publisher's connection.

type AdapterView = FunctionReturnType<typeof api.analytics_connections.list>[number];

function AdapterForm({ instanceId, adapter }: { instanceId: string; adapter: AdapterView }) {
  const save = useMutation(api.analytics_connections.save);
  const remove = useMutation(api.analytics_connections.remove);
  const [url, setUrl] = useState(adapter.url ?? "");
  const [apiKey, setApiKey] = useState("");
  const [options, setOptions] = useState<Record<string, string>>(() =>
    Object.fromEntries(adapter.optionDecls.map((d) => [d.key, String(adapter.options?.[d.key] ?? d.default)])),
  );
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "active" | "error"; text: string } | null>(null);

  async function handleSave() {
    setBusy(true);
    setMessage(null);
    try {
      await save({
        instanceId,
        adapter: adapter.adapter,
        url,
        ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
        options: Object.fromEntries(adapter.optionDecls.map((d) => [d.key, d.type === "number" ? Number(options[d.key]) : (options[d.key] ?? "")])),
      });
      setApiKey("");
      setMessage({ tone: "active", text: "Saved" });
    } catch (error) {
      setMessage({ tone: "error", text: extractConvexErrorMessage(error, "Could not save") });
    } finally {
      setBusy(false);
    }
  }

  async function handleRemove() {
    setBusy(true);
    try {
      await remove({ instanceId, adapter: adapter.adapter });
      setUrl("");
      setApiKey("");
      setMessage(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="grid gap-4 p-5" aria-label={`${adapter.name} analytics connection`}>
      <div className="grid gap-1">
        <h3 className="m-0 text-base font-semibold">{adapter.name}</h3>
        <p className="m-0 text-sm text-muted-foreground">
          {adapter.configured
            ? "Reads with this connection."
            : adapter.publisher
              ? `Not configured: it reads through the ${adapter.publisher} Publisher's connection. Set one here to use another instance or key.`
              : "Not configured: nothing is measured with it yet."}
        </p>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="grid gap-2">
          <Label htmlFor={`analytics-url-${adapter.adapter}`}>{adapter.name} URL</Label>
          <Input id={`analytics-url-${adapter.adapter}`} autoComplete="off" placeholder="https://" value={url} onChange={(e) => setUrl(e.target.value)} />
        </div>
        <div className="grid gap-2">
          <Label htmlFor={`analytics-key-${adapter.adapter}`}>API key</Label>
          <Input
            id={`analytics-key-${adapter.adapter}`}
            type="password"
            autoComplete="off"
            placeholder={adapter.hasApiKey ? "Saved. Type to replace it" : `${adapter.name} API key`}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
          />
        </div>
        {adapter.optionDecls.map((decl) => (
          <div key={decl.key} className="grid gap-2">
            <Label htmlFor={`analytics-option-${adapter.adapter}-${decl.key}`}>{decl.label}</Label>
            <Input
              id={`analytics-option-${adapter.adapter}-${decl.key}`}
                type={decl.type === "number" ? "number" : "text"}
              {...(decl.min !== undefined ? { min: decl.min } : {})}
              {...(decl.max !== undefined ? { max: decl.max } : {})}
              value={options[decl.key] ?? ""}
              onChange={(e) => setOptions((prev) => ({ ...prev, [decl.key]: e.target.value }))}
            />
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" size="lg" disabled={!url.trim() || busy} onClick={() => void handleSave()}>
          {busy ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Save aria-hidden="true" />}
          Save connection
        </Button>
        {adapter.configured ? (
          <Button type="button" variant="outline" size="lg" disabled={busy} onClick={() => void handleRemove()}>
            <Trash2 aria-hidden="true" />
            Remove
          </Button>
        ) : null}
        {message ? <StatusBadge tone={message.tone} label={message.text} /> : null}
      </div>
    </Card>
  );
}

/** The hub's Analytics Adapters that are not installed yet, with an install button. */
function InstallFromHub({ installedNames }: { installedNames: string[] }) {
  const catalogue = useAction(api.hub_packages_node.catalogue);
  const install = useAction(api.hub_packages_node.install);
  const [entries, setEntries] = useState<Array<{ packageId: string; name: string; description: string }> | null>(null);
  const [installing, setInstalling] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void catalogue({ kind: "analytics" })
      .then((result) => {
        if (cancelled) return;
        setEntries(result.entries);
        if (result.error) setError(`The hub could not be read: ${result.error}`);
      })
      .catch((e) => !cancelled && setError(extractConvexErrorMessage(e, "The hub could not be read")));
    return () => {
      cancelled = true;
    };
  }, [catalogue]);

  const available = (entries ?? []).filter((entry) => !installedNames.includes(entry.name));
  if (available.length === 0 && !error) return null;
  return (
    <div className="grid gap-2">
      {available.map((entry) => (
        <Card key={entry.packageId} className="flex flex-row items-center gap-3 p-4">
          <span className="grid flex-1">
            <span className="font-medium">{entry.name} analytics</span>
            {entry.description ? <span className="text-sm text-muted-foreground">{entry.description}</span> : null}
          </span>
          <Button
            type="button"
            variant="outline"
            disabled={installing !== null}
            onClick={() => {
              setInstalling(entry.packageId);
              setError(null);
              install({ kind: "analytics", packageId: entry.packageId })
                .then((result) => {
                  if (result.status === "error") setError(result.errorMessage);
                })
                .catch((e) => setError(extractConvexErrorMessage(e, "The adapter could not be installed")))
                .finally(() => setInstalling(null));
            }}
          >
            {installing === entry.packageId ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Download aria-hidden="true" />}
            Install
          </Button>
        </Card>
      ))}
      {error ? <p className="m-0 text-sm text-destructive">{error}</p> : null}
    </div>
  );
}

/** The Analytics Adapters of the Project: installed ones to configure, and the hub's to install. Nothing while loading. */
export function AnalyticsConnectionsCard({ instanceId }: { instanceId: string | undefined }) {
  const adapters = useQuery(api.analytics_connections.list, instanceId ? { instanceId } : "skip");
  if (!instanceId || adapters === undefined) return null;
  return (
    <section aria-label="Analytics connections" className="grid gap-3">
      <h2 className="m-0 text-xl font-semibold">Connections</h2>
      {adapters.map((adapter) => (
        <AdapterForm key={adapter.adapter} instanceId={instanceId} adapter={adapter} />
      ))}
      <InstallFromHub installedNames={adapters.map((a) => a.name)} />
    </section>
  );
}
