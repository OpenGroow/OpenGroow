"use client";

import { useEffect, useRef, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { Loader2, Save } from "lucide-react";
import { api } from "@convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConnectionJsonSecretField, ConnectionKeyField, ConnectionUrlField } from "@/src/components/connection-fields";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { extractConvexErrorMessage } from "@/src/lib/convex-error";
import { useInstalledPublishers } from "@/src/hooks/use-installed-publishers";
import { PackageVersionCard } from "@/src/components/package-version-card";
import { ProviderDangerZone } from "@/src/components/provider-danger-zone";
import { StatusBadge } from "@/components/opengroow/status-badge";

// The connection of an Analytics Adapter, once per Project (ADR-078), set up
// like a Publisher's: a URL, an API key that is never read back, and the
// options the package declares. Without one, an adapter that belongs to a
// Publisher reads through that Publisher's connection.

type AdapterView = FunctionReturnType<typeof api.analytics_connections.list>[number];

/** An adapter's logo (an image data URI), or the initial of its name when it has none or the image does not load. */
function AdapterLogo({ icon, name, className }: { icon?: string; name: string; className: string }) {
  const [brokenIcon, setBrokenIcon] = useState<string | undefined>();
  if (!icon || brokenIcon === icon) {
    return <span className={`${className} grid place-items-center bg-muted text-sm font-semibold uppercase`} aria-hidden="true">{name.slice(0, 1)}</span>;
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={icon} alt="" className={className} onError={() => setBrokenIcon(icon)} />;
}

/** `embedded`: inside the Publisher's own page, which already names the service. */
export function AdapterForm({ instanceId, adapter, embedded = false }: { instanceId: string; adapter: AdapterView; embedded?: boolean }) {
  const save = useMutation(api.analytics_connections.save);
  const remove = useMutation(api.analytics_connections.remove);
  // An adapter with no URL to give (ADR-079) shows no URL field.
  const needsUrl = adapter.needsUrl !== false;
  const [url, setUrl] = useState(adapter.url ?? "");
  const [apiKey, setApiKey] = useState("");
  const [options, setOptions] = useState<Record<string, string>>(() =>
    Object.fromEntries(adapter.optionDecls.map((d) => [d.key, String(adapter.options?.[d.key] ?? d.default)])),
  );
  const [busy, setBusy] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: "active" | "error"; text: string } | null>(null);

  async function handleSave() {
    setBusy(true);
    setMessage(null);
    try {
      await save({
        instanceId,
        adapter: adapter.adapter,
        // Inside the Publisher's page the connection is the Publisher's own: only the options are saved.
        ...(embedded || !needsUrl ? {} : { url }),
        ...(!embedded && apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
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
      setConfirmRemove(false);
    } catch (error) {
      setRemoveError(extractConvexErrorMessage(error, "The connection could not be removed"));
    } finally {
      setBusy(false);
    }
  }

  const publisherNote = adapter.configured
    ? null
    : adapter.publisher
      ? `Reads through the ${adapter.publisher} Publisher's connection until you set one here.`
      : "Not configured: nothing is measured with it yet.";
  const card = (
      <Card className="gap-4 p-5">
        <h4 className="m-0 text-base font-semibold">{embedded ? "Analytics" : "Connection"}</h4>
        {embedded ? <p className="m-0 text-sm text-muted-foreground">Reads with the connection of this Publisher, set in Configuration.</p> : null}
        <div className="grid gap-4 md:grid-cols-2">
          {embedded ? null : (
            <>
              {needsUrl ? <ConnectionUrlField id={`analytics-url-${adapter.adapter}`} label={`${adapter.name} URL`} value={url} onChange={setUrl} /> : null}
              {adapter.secret?.kind === "json" ? (
                <ConnectionJsonSecretField
                  id={`analytics-key-${adapter.adapter}`}
                  label={adapter.secret.label}
                  placeholder={adapter.hasApiKey ? "Configured. Paste a new one to replace it" : `Paste the ${adapter.secret.label} (JSON)`}
                  value={apiKey}
                  onChange={setApiKey}
                />
              ) : (
                <ConnectionKeyField
                  id={`analytics-key-${adapter.adapter}`}
                  {...(adapter.secret ? { label: adapter.secret.label } : {})}
                  placeholder={adapter.hasApiKey ? "Saved. Type to replace it" : `${adapter.name} ${adapter.secret?.label ?? "API key"}`}
                  value={apiKey}
                  onChange={setApiKey}
                />
              )}
            </>
          )}
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
          <Button type="button" size="lg" disabled={(!embedded && needsUrl && !url.trim()) || busy} onClick={() => void handleSave()}>
            {busy ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Save aria-hidden="true" />}
            Save changes
          </Button>
          {message ? <StatusBadge tone={message.tone} label={message.text} /> : null}
        </div>
      </Card>
  );
  // Inside the Publisher's page the Publisher's own Version card covers this package too.
  const version = adapter.packageId && adapter.version ? <PackageVersionCard packages={[{ kind: "analytics", packageId: adapter.packageId, version: adapter.version, digest: adapter.digest }]} /> : null;
  if (embedded) return card;
  return (
    <section className="grid gap-4 rounded-2xl border border-border bg-card/40 p-5" aria-label={`${adapter.name} analytics connection`}>
      <header className="flex items-center gap-4">
        <AdapterLogo icon={adapter.icon} name={adapter.name} className="size-14 rounded-xl object-contain" />
        <div className="grid flex-1 gap-1">
          <div className="flex flex-wrap items-center gap-3">
            <h3 className="m-0 text-2xl font-semibold">{adapter.name}</h3>
            {adapter.configured ? <StatusBadge tone="active" label="Connected" /> : adapter.publisher ? <StatusBadge tone="info" label="Publisher's connection" /> : <StatusBadge tone="error" label="Not connected" />}
          </div>
          {publisherNote ? <p className="m-0 text-sm text-muted-foreground">{publisherNote}</p> : null}
        </div>
      </header>
      {card}
      {version}
      {adapter.configured ? (
        <ProviderDangerZone
          name={adapter.name}
          summary="Remove this provider's connection from the Project."
          consequences="Its connection and its options are removed from this Project, and nothing is measured with it until you set one again. Readings already taken are kept."
          removing={busy}
          disabled={busy}
          error={removeError}
          confirming={confirmRemove}
          onConfirming={(open) => {
            setRemoveError(null);
            setConfirmRemove(open);
          }}
          onRemove={() => void handleRemove()}
        />
      ) : null}
    </section>
  );
}

/** `@opengroow/analytics-postiz` -> `postiz`: the adapter id of the Publisher a package is conventionally named after (ADR-072). */
export const analyticsAdapterOf = (packageId: string) => packageId.slice(packageId.indexOf("/") + 1).replace(/^analytics-/, "");

/**
 * The Analytics Adapter of an installed Publisher comes with it: the person
 * added the service once, in Publishers, and should not have to add it again
 * here. Installs the hub's analytics package named after each installed Publisher
 * that has none yet, once per package (a failure, such as a non-admin account, leaves it
 * to "Add analytics").
 */
export function useInstallPublishersAnalytics(installedAdapters: string[] | undefined) {
  const publishers = useInstalledPublishers();
  const catalogue = useAction(api.hub_packages_node.catalogue);
  const install = useAction(api.hub_packages_node.install);
  const tried = useRef(new Set<string>());
  const wanted = publishers?.map((p) => p.adapter).sort().join(",");
  const have = installedAdapters?.slice().sort().join(",");
  useEffect(() => {
    if (wanted === undefined || have === undefined || wanted === "") return;
    const installed = new Set(have.split(","));
    const missing = wanted.split(",").filter((adapter) => !installed.has(adapter) && !tried.current.has(adapter));
    if (missing.length === 0) return;
    missing.forEach((adapter) => tried.current.add(adapter));
    void catalogue({ kind: "analytics" })
      .then(async (result) => {
        for (const entry of result.entries) {
          if (missing.includes(analyticsAdapterOf(entry.packageId))) await install({ kind: "analytics", packageId: entry.packageId });
        }
      })
      .catch(() => undefined);
  }, [wanted, have, catalogue, install]);
}

/** The Analytics providers that belong to no Publisher, each with its connection. Nothing while loading. */
export function AnalyticsConnectionsCard({ instanceId }: { instanceId: string | undefined }) {
  const adapters = useQuery(api.analytics_connections.list, instanceId ? { instanceId } : "skip");
  // An adapter of a Publisher is set up in that Publisher's page; only the others live here.
  const standalone = (adapters ?? []).filter((adapter) => !adapter.publisher);
  if (!instanceId || standalone.length === 0) return null;
  return (
    <section aria-label="Analytics connections" className="grid gap-3">
      <h2 className="m-0 text-xl font-semibold">Analytics only providers</h2>
      {standalone.map((adapter) => (
        <AdapterForm key={adapter.adapter} instanceId={instanceId} adapter={adapter} />
      ))}
    </section>
  );
}
