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
// (with its analytics package) and an Analytics Adapter: the installed version, "Check for updates" (the hub is
// read only then), and an update that installs the package again, which replaces it.

type Kind = "publisher" | "analytics";
export type VersionedPackage = { kind: Kind; packageId: string; version: string; digest?: string };
type Behind = { kind: Kind; packageId: string; version: string; rebuilt: boolean };
type Check = { status: "checking" | "upToDate" | "error"; message?: string };

const errorMessage = (error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback);

/**
 * One Version for a service made of one or several packages (a Publisher and its
 * analytics package): the first of `packages` gives the displayed version, and an
 * update installs every package that is behind. `digest` is the one stored at install,
 * which is the release's digest: a package republished under the same version (a local
 * rebuild) shows as a different digest.
 */
export function PackageVersionCard({ packages }: { packages: VersionedPackage[] }) {
  const hubCatalogue = useAction(api.hub_packages_node.catalogue);
  const installPackage = useAction(api.hub_packages_node.install);
  const [updates, setUpdates] = useState<Behind[]>([]);
  const [check, setCheck] = useState<Check | null>(null);
  const [installing, setInstalling] = useState(false);
  const [installError, setInstallError] = useState<string | null>(null);
  const version = packages[0].version;
  const signature = packages.map((p) => `${p.kind}:${p.packageId}@${p.version}#${p.digest ?? ""}`).join("|");
  const update = updates[0] ?? null;
  const rebuilt = updates.every((u) => u.rebuilt);

  // A new installed version or build (an update just applied) makes the last check stale.
  useEffect(() => {
    setUpdates([]);
    setCheck(null);
  }, [signature]);

  async function checkForUpdates() {
    setUpdates([]);
    setCheck({ status: "checking" });
    try {
      const kinds = [...new Set(packages.map((p) => p.kind))];
      const results = await Promise.all(kinds.map((kind) => hubCatalogue({ kind })));
      const failed = results.find((r) => r.error);
      if (failed) {
        setCheck({ status: "error", message: `The hub could not be read: ${failed.error}` });
        return;
      }
      const behind: Behind[] = [];
      for (const pkg of packages) {
        const entries = results[kinds.indexOf(pkg.kind)].entries ?? [];
        const entry = entries.find((e) => e.packageId === pkg.packageId);
        const latest = entry ? versionOfHubTag(entry.tag) : undefined;
        if (entry && latest && isNewerVersion(latest, pkg.version)) behind.push({ kind: pkg.kind, packageId: pkg.packageId, version: latest, rebuilt: false });
        else if (entry && latest === pkg.version && entry.digest && pkg.digest && entry.digest !== pkg.digest) behind.push({ kind: pkg.kind, packageId: pkg.packageId, version: latest, rebuilt: true });
      }
      if (behind.length > 0) {
        setUpdates(behind);
        setCheck(null);
      } else {
        setCheck({ status: "upToDate" });
      }
    } catch (error) {
      setCheck({ status: "error", message: errorMessage(error, "The hub could not be read") });
    }
  }

  async function install() {
    setInstallError(null);
    setInstalling(true);
    let firstError: string | null = null;
    for (const u of updates) {
      try {
        const result = await installPackage({ kind: u.kind, packageId: u.packageId });
        if (result.status === "error") firstError ??= result.errorMessage;
      } catch (error) {
        firstError ??= errorMessage(error, "The package could not be installed");
      }
    }
    setInstallError(firstError);
    setInstalling(false);
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
            {update ? <StatusBadge tone="info" label={rebuilt ? "Update available" : `${update.version} available`} /> : null}
            {check?.status === "error" ? <StatusBadge tone="error" label="Check failed" /> : null}
          </div>
        </div>
        <div className="flex shrink-0">
          {update ? (
            <Button type="button" size="lg" disabled={installing} onClick={() => void install()}>
              {installing ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Download aria-hidden="true" />}
              {rebuilt ? "Reinstall" : `Update to ${update.version}`}
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
