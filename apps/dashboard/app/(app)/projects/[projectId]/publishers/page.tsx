"use client";

import { useCallback, useEffect, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { BarChart3, Download, Eye, EyeOff, KeyRound, Layers, Link2, Loader2, Plug, Plus, RefreshCw, Save, Settings, Trash2, TriangleAlert } from "lucide-react";
import { api } from "@convex/_generated/api";
import type { InstanceRecord } from "@/src/components/instance-workspace.types";
import { findInstanceById } from "@/src/components/instance-workspace.utils";
import { useAuthenticatedInstances } from "@/src/hooks/use-authenticated-instances";
import { useResolvedProjectId } from "@/src/hooks/use-resolved-project-id";
import { useInstalledPublishers } from "@/src/hooks/use-installed-publishers";
import { isNewerVersion, versionOfHubTag } from "@convex/template_manifest_contract";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PanelIcon } from "@/components/opengroow/settings-panel";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { AdapterForm, analyticsAdapterOf, AnalyticsConnectionsCard, useInstallPublishersAnalytics } from "@/src/components/analytics-connections-card";
import { ConnectionKeyField, ConnectionUrlField } from "@/src/components/connection-fields";
import { PageHeader } from "@/components/opengroow/page-header";
import { PackageVersionCard } from "@/src/components/package-version-card";
import { ProviderDangerZone } from "@/src/components/provider-danger-zone";
import { PublishTargetsCard } from "@/src/components/publish-targets-card";
import { StatusBadge } from "@/components/opengroow/status-badge";
import type { ProjectPublisher } from "@/src/hooks/use-project-channels";
import { PackageLogo } from "@/src/components/package-logo";

type PublishersPageProps = {
  params: Promise<{ projectId: string }>;
};

// An input with leading/trailing icons: the icons are flex siblings of a bare input, so they never overlap the text.
const FIELD_CLASS =
  "flex h-10 w-full items-center gap-2 rounded-lg border border-input bg-transparent px-3 transition-colors focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 dark:bg-input/30";
const BARE_INPUT_CLASS =
  "h-full w-full min-w-0 border-0 bg-transparent p-0 text-base outline-none placeholder:text-muted-foreground md:text-sm";

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

/** `@opengroow/publisher-postiz` -> `postiz`: the adapter id a package is conventionally installed under (ADR-072). */
const adapterOf = (packageId: string) => packageId.slice(packageId.indexOf("/") + 1).replace(/^publisher-/, "");

export default function PublishersPage({ params }: PublishersPageProps) {
  const resolvedInstanceId = useResolvedProjectId(params);
  const instances = useAuthenticatedInstances<InstanceRecord>();
  const instance = findInstanceById(instances, resolvedInstanceId);
  const instanceId = instance?.openclawId;

  // Several Publishers per Project, at most one per adapter (ADR-075).
  const publishers = useQuery(api.publishers.list, instanceId ? { instanceId } : "skip");
  const hubCatalogue = useAction(api.hub_packages_node.catalogue);
  const installPackage = useAction(api.hub_packages_node.install);
  const installed = useInstalledPublishers();

  // The adapter of the Publisher being added (its package is installed), before its first save.
  const [adding, setAdding] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [catalogue, setCatalogue] = useState<{ entries: Array<{ packageId: string; name: string; description: string; icon?: string }>; error?: string } | null>(null);
  const [analyticsCatalogue, setAnalyticsCatalogue] = useState<Array<{ packageId: string; name: string; description: string; icon?: string }>>([]);
  const analyticsProviders = useQuery(api.analytics_connections.list, instanceId ? { instanceId } : "skip");
  useInstallPublishersAnalytics(analyticsProviders?.map((a) => a.adapter));
  const [installing, setInstalling] = useState<string | null>(null);
  const [installError, setInstallError] = useState<string | null>(null);
  // A package just installed: the dialog continues once its data has arrived through the reactive query.
  const [awaiting, setAwaiting] = useState<string | null>(null);

  useEffect(() => {
    if (!picking) return;
    setInstallError(null);
    setCatalogue(null);
    let cancelled = false;
    setAnalyticsCatalogue([]);
    void hubCatalogue({ kind: "analytics" })
      .then((result) => !cancelled && setAnalyticsCatalogue(result.entries))
      .catch(() => undefined);
    hubCatalogue({ kind: "publisher" })
      .then((result) => {
        if (!cancelled) setCatalogue(result);
      })
      .catch((error) => {
        if (!cancelled) setCatalogue({ entries: [], error: errorMessage(error, "The hub could not be read") });
      });
    return () => {
      cancelled = true;
    };
  }, [picking, hubCatalogue]);

  useEffect(() => {
    if (!awaiting) return;
    const ready = installed?.find((p) => p.packageId === awaiting);
    if (!ready) return;
    setAwaiting(null);
    setInstalling(null);
    setPicking(false);
    setAdding(ready.adapter);
  }, [awaiting, installed]);

  // The Publisher being added is saved: it is now one of the list.
  useEffect(() => {
    if (adding && publishers?.some((p) => p.adapter === adding)) setAdding(null);
  }, [adding, publishers]);

  if (!instance || !instanceId) return null;
  const id = instanceId;
  const configured = new Set((publishers ?? []).map((p) => p.adapter));

  async function choose(packageId: string) {
    setInstallError(null);
    const already = installed?.find((p) => p.packageId === packageId);
    if (already) {
      setPicking(false);
      setAdding(already.adapter);
      return;
    }
    setInstalling(packageId);
    try {
      const result = await installPackage({ kind: "publisher", packageId });
      if (result.status === "error") {
        setInstallError(result.errorMessage);
        setInstalling(null);
        return;
      }
      setAwaiting(packageId);
    } catch (error) {
      setInstallError(errorMessage(error, "The publisher could not be installed"));
      setInstalling(null);
    }
  }

  // What can be added: the hub's packages, plus installed ones the hub does not list (hub unreachable, or removed
  // from it), without the services already on the Project (one Publisher per adapter, each on its own card).
  const choices = catalogue
    ? [
        ...catalogue.entries,
        ...(installed ?? [])
          .filter((p) => !catalogue.entries.some((e) => e.packageId === p.packageId))
          .map((p) => ({ packageId: p.packageId, name: p.name, description: "", icon: p.icon })),
      ].filter((entry) => !configured.has(installed?.find((p) => p.packageId === entry.packageId)?.adapter ?? adapterOf(entry.packageId)))
    : [];
  // The analytics providers that belong to no Publisher, not added yet: a Publisher's own comes with it.
  const publisherAdapters = new Set([...(catalogue?.entries ?? []).map((e) => adapterOf(e.packageId)), ...(installed ?? []).map((p) => p.adapter)]);
  const analyticsChoices = analyticsCatalogue.filter(
    (entry) => !publisherAdapters.has(analyticsAdapterOf(entry.packageId)) && !(analyticsProviders ?? []).some((a) => a.adapter === analyticsAdapterOf(entry.packageId)),
  );

  async function chooseAnalytics(packageId: string) {
    setInstallError(null);
    setInstalling(packageId);
    try {
      const result = await installPackage({ kind: "analytics", packageId });
      if (result.status === "error") setInstallError(result.errorMessage);
      else setPicking(false);
    } catch (error) {
      setInstallError(errorMessage(error, "The analytics provider could not be installed"));
    } finally {
      setInstalling(null);
    }
  }

  // The Publishers of the Project that are measured by an adapter that comes with them, and those that publish only.
  const withAnalytics = (publishers ?? []).filter((p) => (analyticsProviders ?? []).some((a) => a.publisher === p.adapter));
  const publishOnlyAdded = (publishers ?? []).filter((p) => !withAnalytics.includes(p));
  const showAdding = adding !== null && !configured.has(adding);
  const empty = (publishers ?? []).length === 0 && !showAdding;

  return (
    <div className="grid gap-8">
      <PageHeader
        title="Publishers & Analytics"
        description="Connect the services that publish your content and measure how it performs."
        action={
          <Button type="button" size="lg" disabled={showAdding} onClick={() => setPicking(true)}>
            <Plus aria-hidden="true" />
            Add provider
          </Button>
        }
      />

      <Dialog open={picking} onOpenChange={setPicking}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add a provider</DialogTitle>
            <DialogDescription>Choose a service that publishes your content or measures how it performs.</DialogDescription>
          </DialogHeader>
          {catalogue === null ? (
            <p className="m-0 flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              Reading the hub
            </p>
          ) : (
            <div className="grid gap-2">
              {catalogue.error ? <p className="m-0 text-sm text-destructive">The hub could not be read: {catalogue.error}</p> : null}
              {analyticsChoices.length > 0 ? <h3 className="m-0 mt-1 text-sm font-medium text-muted-foreground">Publishers</h3> : null}
              {choices.map((entry) => {
                const isInstalled = installed?.some((p) => p.packageId === entry.packageId) ?? false;
                return (
                  <button
                    key={entry.packageId}
                    type="button"
                    disabled={installing !== null}
                    className="flex items-center gap-3 rounded-lg border border-border p-3 text-left hover:bg-muted disabled:opacity-60"
                    onClick={() => void choose(entry.packageId)}
                  >
                    <PackageLogo icon={entry.icon} name={entry.name} className="size-10 rounded-lg object-contain" />
                    <span className="grid flex-1">
                      <span className="text-base font-medium">{entry.name}</span>
                      {entry.description ? <span className="text-sm text-muted-foreground">{entry.description}</span> : null}
                    </span>
                    {installing === entry.packageId ? (
                      <Loader2 className="size-4 animate-spin" aria-label="Installing" />
                    ) : isInstalled ? null : (
                      <Download className="size-4 text-muted-foreground" aria-label="Will be installed" />
                    )}
                  </button>
                );
              })}
              {choices.length === 0 && !catalogue.error ? (
                <p className="m-0 text-sm text-muted-foreground">
                  {catalogue.entries.length === 0 && (installed ?? []).length === 0 ? "The hub lists no publisher." : "Every publisher of the hub is already added."}
                </p>
              ) : null}
              {analyticsChoices.length > 0 ? (
                <>
                  <h3 className="m-0 mt-3 text-sm font-medium text-muted-foreground">Analytics providers</h3>
                  {analyticsChoices.map((entry) => (
                    <button
                      key={entry.packageId}
                      type="button"
                      disabled={installing !== null}
                      className="flex items-center gap-3 rounded-lg border border-border p-3 text-left hover:bg-muted disabled:opacity-60"
                      onClick={() => void chooseAnalytics(entry.packageId)}
                    >
                      <PackageLogo icon={entry.icon} name={entry.name} className="size-10 rounded-lg object-contain" />
                      <span className="grid flex-1">
                        <span className="text-base font-medium">{entry.name}</span>
                        {entry.description ? <span className="text-sm text-muted-foreground">{entry.description}</span> : null}
                      </span>
                      {installing === entry.packageId ? <Loader2 className="size-4 animate-spin" aria-label="Installing" /> : <Download className="size-4 text-muted-foreground" aria-label="Will be installed" />}
                    </button>
                  ))}
                </>
              ) : null}
            </div>
          )}
          {installError ? <p className="m-0 text-sm text-destructive">{installError}</p> : null}
        </DialogContent>
      </Dialog>

      {empty ? (
        <Card className="p-5 text-sm text-muted-foreground">No publisher yet. Add one to publish your Agents&apos; content.</Card>
      ) : null}
      {withAnalytics.length > 0 ? <h2 className="m-0 text-xl font-semibold">Analytics &amp; Publish providers</h2> : null}
      {withAnalytics.map((publisher) => (
        <PublisherPanel key={publisher.adapter} instanceId={id} adapter={publisher.adapter} publisher={publisher} />
      ))}
      {publishOnlyAdded.length > 0 ? <h2 className="m-0 text-xl font-semibold">Publishers only providers</h2> : null}
      {publishOnlyAdded.map((publisher) => (
        <PublisherPanel key={publisher.adapter} instanceId={id} adapter={publisher.adapter} publisher={publisher} />
      ))}
      {showAdding ? (
        <PublisherPanel key={`adding-${adding}`} instanceId={id} adapter={adding} publisher={null} onCancel={() => setAdding(null)} />
      ) : null}
      <AnalyticsConnectionsCard instanceId={instanceId} />
    </div>
  );
}

/**
 * One Publisher of the Project: its connection, its package version and its
 * channels. `publisher` is null while it is being added (before its first save).
 */
function PublisherPanel({
  instanceId: id,
  adapter: adapterId,
  publisher,
  onCancel,
}: {
  instanceId: string;
  adapter: string;
  publisher: ProjectPublisher | null;
  onCancel?: () => void;
}) {
  const installed = useInstalledPublishers();
  const save = useMutation(api.publishers.save);
  const remove = useMutation(api.publishers.remove);
  const testConnection = useAction(api.publishers_node.testConnection);
  const hubCatalogue = useAction(api.hub_packages_node.catalogue);
  const installPackage = useAction(api.hub_packages_node.install);
  // The Analytics Adapter that belongs to this Publisher (ADR-078): its settings are a tab here.
  const analyticsAdapter = useQuery(api.analytics_connections.list, publisher ? { instanceId: id } : "skip")?.find((a) => a.publisher === adapterId);

  const [url, setUrl] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [installing, setInstalling] = useState<string | null>(null);
  const [installError, setInstallError] = useState<string | null>(null);
  // A Publisher exists but its package is not installed (it predates installable packages): the hub's entry that provides it.
  const [missing, setMissing] = useState<{ entry?: { packageId: string; name: string; icon?: string }; error?: string } | null>(null);
  const [tab, setTab] = useState<"configuration" | "channels" | "analytics">("configuration");
  const [connected, setConnected] = useState<boolean | null>(null);
  const [busy, setBusy] = useState<"save" | "test" | "remove" | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: "active" | "error"; text: string } | null>(null);

  const checkConnection = useCallback(async () => {
    try {
      const result = await testConnection({ instanceId: id, adapter: adapterId });
      setConnected(result.ok);
    } catch {
      setConnected(false);
    }
  }, [id, adapterId, testConnection]);

  const hasApiKey = publisher?.hasApiKey ?? false;
  // Without its package the Publisher cannot be called: nothing to check until it is installed.
  const installedPackage = installed?.find((p) => p.adapter === adapterId);
  const packageInstalled = installedPackage !== undefined;
  const packageMissing = Boolean(publisher) && installed !== undefined && !packageInstalled;
  useEffect(() => {
    if (hasApiKey && packageInstalled) void checkConnection();
    else setConnected(null);
  }, [hasApiKey, packageInstalled, checkConnection]);

  useEffect(() => {
    if (!packageMissing) {
      setMissing(null);
      return;
    }
    let cancelled = false;
    hubCatalogue({ kind: "publisher" })
      .then((result) => {
        if (cancelled) return;
        const entry = result.entries.find((e) => adapterOf(e.packageId) === adapterId);
        setMissing(entry ? { entry } : { error: result.error ?? `The hub has no package for "${adapterId}"` });
      })
      .catch((error) => {
        if (!cancelled) setMissing({ error: errorMessage(error, "The hub could not be read") });
      });
    return () => {
      cancelled = true;
    };
  }, [packageMissing, adapterId, hubCatalogue]);

  const installedPackageId = installedPackage?.packageId;
  const installedVersion = installedPackage?.version;
  const urlValue = url ?? publisher?.url ?? "";
  const serviceName = installedPackage?.name ?? adapterId;

  async function installMissing(packageId: string) {
    setInstallError(null);
    setInstalling(packageId);
    try {
      const result = await installPackage({ kind: "publisher", packageId });
      if (result.status === "error") setInstallError(result.errorMessage);
    } catch (error) {
      setInstallError(errorMessage(error, "The publisher could not be installed"));
    } finally {
      setInstalling(null);
    }
  }

  async function handleSave() {
    setBusy("save");
    setMessage(null);
    try {
      await save({ instanceId: id, adapter: adapterId, url: urlValue, apiKey: apiKey || undefined });
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
      const result = await testConnection({ instanceId: id, adapter: adapterId });
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

  async function handleRemove() {
    setBusy("remove");
    try {
      await remove({ instanceId: id, adapter: adapterId });
      setConfirmRemove(false);
    } catch (error) {
      setRemoveError(errorMessage(error, "The publisher could not be removed"));
    } finally {
      setBusy(null);
    }
  }

  const tabClass = (active: boolean) =>
    `flex items-center gap-2 border-b-2 px-4 pb-3 text-sm font-medium ${
      active ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
    }`;

  return (
      <section className="grid gap-6 rounded-2xl border border-border bg-card/40 p-5" data-testid={`publisher-${adapterId}`} aria-label={serviceName}>
      <header className="grid gap-4">
        <div className="flex items-center gap-4">
          <PackageLogo icon={installedPackage?.icon ?? missing?.entry?.icon} name={serviceName} className="size-14 rounded-xl object-contain" />
          <div className="grid flex-1 gap-1">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="m-0 text-2xl font-semibold">{serviceName}</h1>
              {connected === true ? <StatusBadge tone="active" label="Connected" /> : null}
              {connected === false ? <StatusBadge tone="error" label="Not connected" /> : null}
              {publisher && !publisher.hasApiKey ? <StatusBadge tone="warning" label="API key missing" /> : null}
            </div>
          </div>
          {!publisher && onCancel ? (
            <Button type="button" variant="outline" size="lg" disabled={busy !== null} onClick={onCancel}>
              Cancel
            </Button>
          ) : null}
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
          {analyticsAdapter ? (
            <button type="button" role="tab" aria-selected={tab === "analytics"} className={tabClass(tab === "analytics")} onClick={() => setTab("analytics")}>
              <BarChart3 className="size-4" aria-hidden="true" />
              Analytics
            </button>
          ) : null}
        </div>
      </header>

      {packageMissing ? (
        <Card className="gap-3 border-amber-500/40 p-5" data-testid="package-missing">
          <h2 className="m-0 text-base font-semibold">{missing?.entry?.name ?? serviceName} is not installed</h2>
          <p className="m-0 text-sm text-muted-foreground">
            This Publisher was set up before publishers became installable packages. Install its package to use it again; the connection and the channels below are kept.
          </p>
          {missing === null ? (
            <p className="m-0 flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              Reading the hub
            </p>
          ) : null}
          {missing?.error ? <p className="m-0 text-sm text-destructive">{missing.error}</p> : null}
          {installError ? <p className="m-0 text-sm text-destructive">{installError}</p> : null}
          <div>
            <Button type="button" disabled={!missing?.entry || installing !== null} onClick={() => void installMissing(missing!.entry!.packageId)}>
              {installing ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Download aria-hidden="true" />}
              Install {missing?.entry?.name ?? serviceName}
            </Button>
          </div>
        </Card>
      ) : null}

      {tab === "configuration" ? (
        <>
        <Card className="gap-4 p-5">
          <h2 className="m-0 text-base font-semibold">Connection</h2>
          <div className="grid gap-4 md:grid-cols-2">
            <ConnectionUrlField id={`publisher-url-${adapterId}`} label={installedPackage?.connectionUrlLabel ?? `${serviceName} URL`} value={urlValue} onChange={setUrl} />
            <ConnectionKeyField
              id={`publisher-api-key-${adapterId}`}
              placeholder={publisher?.hasApiKey ? "Saved. Type to replace it" : `${serviceName} API key`}
              value={apiKey}
              onChange={setApiKey}
            />
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
        {installedPackageId && installedVersion ? (
          <PackageVersionCard
            packages={[
              { kind: "publisher", packageId: installedPackageId, version: installedVersion, digest: installedPackage?.digest },
              ...(analyticsAdapter?.packageId && analyticsAdapter.version ? [{ kind: "analytics" as const, packageId: analyticsAdapter.packageId, version: analyticsAdapter.version, digest: analyticsAdapter.digest }] : []),
            ]}
          />
        ) : null}
        {publisher ? (
          <ProviderDangerZone
            name={serviceName}
            summary="Remove this publisher from the Project, with its connection and its channels."
            consequences={`Its connection and its ${publisher.targets.length} channel(s) are removed from this Project. Missions and Schedules that publish to them will be refused until you choose other channels. Past publications are kept.`}
            removing={busy === "remove"}
            disabled={busy !== null}
            error={removeError}
            confirming={confirmRemove}
            onConfirming={(open) => {
              setRemoveError(null);
              setConfirmRemove(open);
            }}
            onRemove={() => void handleRemove()}
          />
        ) : null}
        </>
      ) : tab === "analytics" && analyticsAdapter ? (
        <AdapterForm instanceId={id} adapter={analyticsAdapter} embedded />
      ) : publisher ? (
        <PublishTargetsCard instanceId={id} publisher={publisher} />
      ) : (
        <Card className="p-5 text-sm text-muted-foreground">Save the connection first to list your channels.</Card>
      )}
      </section>
  );
}
