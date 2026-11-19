"use client";

import { useEffect, useState } from "react";
import { useAction } from "convex/react";
import { Download, Loader2, RefreshCw } from "lucide-react";
import { api } from "@convex/_generated/api";
import { isNewerVersion, versionOfHubTag } from "@convex/template_manifest_contract";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { StatusBadge } from "@/components/opengroow/status-badge";

// The Version card of an installed hub package (ADR-072), the same for a Publisher
// and an Analytics Adapter: the installed version, "Check for updates" (the hub is
// read only then), and an update that installs the package again, which replaces it.

type Kind = "publisher" | "analytics";
type Update = { packageId: string; version: string; rebuilt: boolean };
type Check = { status: "checking" | "upToDate" | "error"; message?: string };

const errorMessage = (error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback);

/**
 * `digest` is the one stored at install, which is the release's digest: a package
 * republished under the same version (a local rebuild) shows as a different digest.
 */
export function PackageVersionCard({ kind, packageId, version, digest }: { kind: Kind; packageId: string; version: string; digest?: string }) {
  const hubCatalogue = useAction(api.hub_packages_node.catalogue);
  const installPackage = useAction(api.hub_packages_node.install);
  const [update, setUpdate] = useState<Update | null>(null);
  const [check, setCheck] = useState<Check | null>(null);
  const [installing, setInstalling] = useState(false);
  const [installError, setInstallError] = useState<string | null>(null);

  // A new installed version or build (an update just applied) makes the last check stale.
  useEffect(() => {
    setUpdate(null);
    setCheck(null);
  }, [packageId, version, digest]);

  async function checkForUpdates() {
    setUpdate(null);
    setCheck({ status: "checking" });
    try {
      const result = await hubCatalogue({ kind });
      if (result.error) {
        setCheck({ status: "error", message: `The hub could not be read: ${result.error}` });
        return;
      }
      const entry = (result.entries ?? []).find((e) => e.packageId === packageId);
      const latest = entry ? versionOfHubTag(entry.tag) : undefined;
      if (entry && latest && isNewerVersion(latest, version)) {
        setUpdate({ packageId: entry.packageId, version: latest, rebuilt: false });
        setCheck(null);
      } else if (entry && latest === version && entry.digest && digest && entry.digest !== digest) {
        setUpdate({ packageId: entry.packageId, version: latest, rebuilt: true });
        setCheck(null);
      } else {
        setCheck({ status: "upToDate" });
      }
    } catch (error) {
      setCheck({ status: "error", message: errorMessage(error, "The hub could not be read") });
    }
  }

  async function install(id: string) {
    setInstallError(null);
    setInstalling(true);
    try {
      const result = await installPackage({ kind, packageId: id });
      if (result.status === "error") setInstallError(result.errorMessage);
    } catch (error) {
      setInstallError(errorMessage(error, "The package could not be installed"));
    } finally {
      setInstalling(false);
    }
  }

  return (
    <Card className="gap-4 p-5" data-testid="package-updates">
      <h2 className="m-0 text-base font-semibold">Version</h2>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <div className="grid flex-1 gap-1">
          <span className="text-sm text-muted-foreground">Current version</span>
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-2xl font-semibold">{version}</span>
            {check?.status === "checking" ? <StatusBadge tone="progress" label="Checking…" /> : null}
            {check?.status === "upToDate" ? <StatusBadge tone="active" label="Up to date" /> : null}
            {update ? <StatusBadge tone="info" label={update.rebuilt ? "Update available" : `${update.version} available`} /> : null}
            {check?.status === "error" ? <StatusBadge tone="error" label="Check failed" /> : null}
          </div>
        </div>
        <div className="flex shrink-0">
          {update ? (
            <Button type="button" size="lg" disabled={installing} onClick={() => void install(update.packageId)}>
              {installing ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Download aria-hidden="true" />}
              {update.rebuilt ? "Reinstall" : `Update to ${update.version}`}
            </Button>
          ) : (
            <Button type="button" variant="outline" size="lg" disabled={check?.status === "checking" || installing} onClick={() => void checkForUpdates()}>
              {check?.status === "checking" ? <Loader2 className="animate-spin" aria-hidden="true" /> : <RefreshCw aria-hidden="true" />}
              Check for updates
            </Button>
          )}
        </div>
      </div>
      {check?.status === "error" ? <p className="m-0 text-sm text-destructive">{check.message}</p> : null}
      {update && installError ? <p className="m-0 text-sm text-destructive">{installError}</p> : null}
    </Card>
  );
}
