"use client";

import { useCallback, useEffect, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { Download, Eye, EyeOff, KeyRound, Layers, Link2, Loader2, Plug, Plus, RefreshCw, Save, Settings, Trash2, TriangleAlert } from "lucide-react";
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
import { PageHeader } from "@/components/opengroow/page-header";
import { PublishTargetsCard } from "@/src/components/publish-targets-card";
import { StatusBadge } from "@/components/opengroow/status-badge";
import type { ProjectPublisher } from "@/src/hooks/use-project-channels";

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

/**
 * A Publisher package's logo: the image data URI the hub gives it (index entry
 * before the install, manifest after), or the initial of its name when it has
 * none or the image does not load.
 */
function PublisherLogo({ icon, name, className }: { icon?: string; name: string; className: string }) {
  const [brokenIcon, setBrokenIcon] = useState<string | undefined>();
  if (!icon || brokenIcon === icon) {
    return <span className={`${className} grid place-items-center bg-muted text-sm font-semibold uppercase`} aria-hidden="true">{name.slice(0, 1)}</span>;
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={icon} alt="" className={className} onError={() => setBrokenIcon(icon)} />;
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
  const [installing, setInstalling] = useState<string | null>(null);
  const [installError, setInstallError] = useState<string | null>(null);
  // A package just installed: the dialog continues once its data has arrived through the reactive query.
  const [awaiting, setAwaiting] = useState<string | null>(null);

  useEffect(() => {
    if (!picking) return;
    setInstallError(null);
    setCatalogue(null);
    let cancelled = false;
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
  const showAdding = adding !== null && !configured.has(adding);
  const empty = (publishers ?? []).length === 0 && !showAdding;

  return (
    <div className="grid gap-8">
      <PageHeader
        title="Publishers"
        description="Connect the services that will publish your content."
        action={
          <Button type="button" size="lg" disabled={showAdding} onClick={() => setPicking(true)}>
            <Plus aria-hidden="true" />
            Add publisher
          </Button>
        }
      />

      <Dialog open={picking} onOpenChange={setPicking}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add a publisher</DialogTitle>
            <DialogDescription>Choose the service that will publish your content.</DialogDescription>
          </DialogHeader>
          {catalogue === null ? (
            <p className="m-0 flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              Reading the hub
            </p>
          ) : (
            <div className="grid gap-2">
              {catalogue.error ? <p className="m-0 text-sm text-destructive">The hub could not be read: {catalogue.error}</p> : null}
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
                    <PublisherLogo icon={entry.icon} name={entry.name} className="size-10 rounded-lg object-contain" />
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
            </div>
          )}
          {installError ? <p className="m-0 text-sm text-destructive">{installError}</p> : null}
        </DialogContent>
      </Dialog>

      {empty ? (
        <Card className="p-5 text-sm text-muted-foreground">No publisher yet. Add one to publish your Agents&apos; content.</Card>
      ) : null}
      {(publishers ?? []).map((publisher) => (
        <PublisherPanel key={publisher.adapter} instanceId={id} adapter={publisher.adapter} publisher={publisher} />
      ))}
      {showAdding ? (
        <PublisherPanel key={`adding-${adding}`} instanceId={id} adapter={adding} publisher={null} onCancel={() => setAdding(null)} />
      ) : null}
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

  const [url, setUrl] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [installing, setInstalling] = useState<string | null>(null);
  const [installError, setInstallError] = useState<string | null>(null);
  // A Publisher exists but its package is not installed (it predates installable packages): the hub's entry that provides it.
  const [missing, setMissing] = useState<{ entry?: { packageId: string; name: string; icon?: string }; error?: string } | null>(null);
  // A newer version of the installed package in the hub (ADR-072), found by "Check for updates": installing it again replaces the installed one.
  const [update, setUpdate] = useState<{ packageId: string; name: string; version: string } | null>(null);
  // The outcome of the last check: the hub is read only when the user asks.
  const [updateCheck, setUpdateCheck] = useState<{ status: "checking" | "upToDate" | "error"; message?: string } | null>(null);
  const [tab, setTab] = useState<"configuration" | "channels">("configuration");
  const [showKey, setShowKey] = useState(false);
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
  // A new installed version (an update just applied) makes the last check stale.
  useEffect(() => {
    setUpdate(null);
    setUpdateCheck(null);
  }, [installedPackageId, installedVersion]);

  async function checkForUpdates() {
    if (!installedPackageId || !installedVersion) return;
    setUpdate(null);
    setUpdateCheck({ status: "checking" });
    try {
      const result = await hubCatalogue({ kind: "publisher" });
      if (result.error) {
        setUpdateCheck({ status: "error", message: `The hub could not be read: ${result.error}` });
        return;
      }
      const entry = (result.entries ?? []).find((e) => e.packageId === installedPackageId);
      const version = entry ? versionOfHubTag(entry.tag) : undefined;
      if (entry && version && isNewerVersion(version, installedVersion)) {
        setUpdate({ packageId: entry.packageId, name: entry.name, version });
        setUpdateCheck(null);
      } else {
        setUpdateCheck({ status: "upToDate" });
      }
    } catch (error) {
      setUpdateCheck({ status: "error", message: errorMessage(error, "The hub could not be read") });
    }
  }

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
          <PublisherLogo icon={installedPackage?.icon ?? missing?.entry?.icon} name={serviceName} className="size-14 rounded-xl object-contain" />
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
            <div className="grid gap-2">
              <Label htmlFor={`publisher-url-${adapterId}`}>{installedPackage?.connectionUrlLabel ?? `${serviceName} URL`}</Label>
              <div className={FIELD_CLASS}>
                <Link2 className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <input
                  id={`publisher-url-${adapterId}`}
                  name="url"
                  className={BARE_INPUT_CLASS}
                  autoComplete="off"
                  placeholder="https://"
                  value={urlValue}
                  onChange={(event) => setUrl(event.target.value)}
                />
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor={`publisher-api-key-${adapterId}`}>API key</Label>
              <div className={FIELD_CLASS}>
                <KeyRound className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <input
                  id={`publisher-api-key-${adapterId}`}
                  name="apiKey"
                  className={BARE_INPUT_CLASS}
                  type={showKey ? "text" : "password"}
                  autoComplete="off"
                  placeholder={publisher?.hasApiKey ? "Saved. Type to replace it" : `${serviceName} API key`}
                  value={apiKey}
                  onChange={(event) => setApiKey(event.target.value)}
                />
                <button
                  type="button"
                  aria-label={showKey ? "Hide API key" : "Show API key"}
                  className="shrink-0 text-muted-foreground hover:text-foreground"
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
        {installedVersion ? (
          <Card className="gap-4 p-5" data-testid="package-updates">
            <h2 className="m-0 text-base font-semibold">Version</h2>
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
              <div className="grid flex-1 gap-1">
                <span className="text-sm text-muted-foreground">Current version</span>
                <div className="flex flex-wrap items-center gap-3">
                  <span className="text-2xl font-semibold">{installedVersion}</span>
                  {updateCheck?.status === "checking" ? <StatusBadge tone="progress" label="Checking…" /> : null}
                  {updateCheck?.status === "upToDate" ? <StatusBadge tone="active" label="Up to date" /> : null}
                  {update ? <StatusBadge tone="info" label={`${update.version} available`} /> : null}
                  {updateCheck?.status === "error" ? <StatusBadge tone="error" label="Check failed" /> : null}
                </div>
              </div>
              <div className="flex shrink-0">
                {update ? (
                  <Button type="button" size="lg" disabled={installing !== null} onClick={() => void installMissing(update.packageId)}>
                    {installing ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Download aria-hidden="true" />}
                    Update to {update.version}
                  </Button>
                ) : (
                  <Button type="button" variant="outline" size="lg" disabled={updateCheck?.status === "checking" || installing !== null} onClick={() => void checkForUpdates()}>
                    {updateCheck?.status === "checking" ? <Loader2 className="animate-spin" aria-hidden="true" /> : <RefreshCw aria-hidden="true" />}
                    Check for updates
                  </Button>
                )}
              </div>
            </div>
            {updateCheck?.status === "error" ? <p className="m-0 text-sm text-destructive">{updateCheck.message}</p> : null}
            {update && installError ? <p className="m-0 text-sm text-destructive">{installError}</p> : null}
          </Card>
        ) : null}
        {publisher ? (
          <PublisherDangerZone
            name={serviceName}
            channelCount={publisher.targets.length}
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
      ) : publisher ? (
        <PublishTargetsCard instanceId={id} publisher={publisher} />
      ) : (
        <Card className="p-5 text-sm text-muted-foreground">Save the connection first to list your channels.</Card>
      )}
      </section>
  );
}

/**
 * Removing the Publisher from the Project, as the Agent page's Danger zone does:
 * the last card of the settings, confirmed in a dialog that says what it does.
 */
function PublisherDangerZone({
  name,
  channelCount,
  removing,
  disabled,
  error,
  confirming,
  onConfirming,
  onRemove,
}: {
  name: string;
  channelCount: number;
  removing: boolean;
  disabled: boolean;
  error: string | null;
  confirming: boolean;
  onConfirming: (open: boolean) => void;
  onRemove: () => void;
}) {
  return (
    <Card data-slot="settings-panel" aria-label="Danger zone">
      <CardContent className="grid gap-6">
        <div className="flex items-start gap-4">
          <PanelIcon icon={TriangleAlert} tone="danger" />
          <div className="grid gap-1">
            <h2 className="m-0 text-lg font-semibold text-foreground">Danger zone</h2>
            <p className="m-0 text-sm text-muted-foreground">Remove this publisher from the Project, with its connection and its channels.</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-3">
          <Button className="w-32" variant="outline" size="lg" type="button" disabled={disabled} onClick={() => onConfirming(true)}>
            <Trash2 />
            Remove
          </Button>
        </div>
        <Dialog open={confirming} onOpenChange={(open) => !open && !removing && onConfirming(false)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Remove {name}?</DialogTitle>
              <DialogDescription>
                Its connection and its {channelCount} channel(s) are removed from this Project. Missions and Schedules that publish to them will be
                refused until you choose other channels. Past publications are kept.
              </DialogDescription>
            </DialogHeader>
            {error ? (
              <p role="alert" className="m-0 text-sm text-destructive">
                {error}
              </p>
            ) : null}
            <DialogFooter>
              <Button variant="outline" type="button" disabled={removing} onClick={() => onConfirming(false)}>
                Cancel
              </Button>
              <Button variant="destructive" type="button" loading={removing} onClick={onRemove}>
                {removing ? null : <Trash2 />}
                {removing ? "Removing…" : `Remove ${name}`}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}
