"use client";

import * as React from "react";
import { useAction, useQuery } from "convex/react";
import { Eye, Loader2, Package, RefreshCw } from "lucide-react";
import { api } from "@convex/_generated/api";
import { PanelIcon } from "@/components/opengroow/settings-panel";
import { StatusBadge } from "@/components/opengroow/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { TemplateUpdateReviewDialog, type UpdateOffer } from "@/src/components/template-updates-panel";

const ORIGIN_LABEL: Record<string, string> = {
  // A copy from a folder on the operator's machine, added once or kept linked: one label.
  local_folder: "Local",
  linked_folder: "Local",
  git: "Git",
};

/**
 * The installed version of an Agent's Template. For a Template from the hub,
 * "Check for updates" asks the hub on demand for this Template only
 * (`checkHubUpdates` with `templateId`, nothing is read before); a newer
 * version is offered, then reviewed and applied through
 * its update plan. Other origins are not checked: their label is shown instead.
 */
export function AgentVersionCard({ projectId, templateId }: { projectId: string; templateId: string }) {
  const installs = useQuery(api.project_templates.origins, { projectId });
  const offers = useQuery(api.project_templates.updates, { projectId });
  const checkHubUpdates = useAction(api.project_templates_node.checkHubUpdates);
  const [check, setCheck] = React.useState<{ status: "checking" | "upToDate" | "error"; message?: string } | null>(null);
  const [reviewing, setReviewing] = React.useState<UpdateOffer | null>(null);

  const install = installs?.find((candidate) => candidate.templateId === templateId);
  const offer = offers?.find((candidate) => candidate.templateId === templateId) ?? null;
  const version = install?.version;
  // An applied update makes the last check stale.
  React.useEffect(() => setCheck(null), [version]);
  if (!install) return null;
  const fromHub = install.origin === "hub";

  async function checkForUpdates() {
    setCheck({ status: "checking" });
    try {
      const result = await checkHubUpdates({ instanceId: projectId, templateId });
      if (result.error) {
        setCheck({ status: "error", message: result.error });
        return;
      }
      // A newer version offered now, or earlier and not applied, shows through `offer`.
      setCheck(result.offered.some((o) => o.templateId === templateId) ? null : { status: "upToDate" });
    } catch (error) {
      setCheck({ status: "error", message: error instanceof Error ? error.message : "The hub could not be read" });
    }
  }

  const checking = check?.status === "checking";
  return (
    <Card data-slot="settings-panel" className="max-w-3xl" aria-label="Version">
      <CardContent className="grid gap-6">
        <div className="flex items-center gap-4">
          <PanelIcon icon={Package} tone="blue" />
          <h2 className="m-0 text-lg font-semibold text-foreground">Version</h2>
        </div>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
          <div className="grid flex-1 gap-1">
            <span className="text-sm text-muted-foreground">Current version</span>
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-2xl font-semibold text-foreground">{install.version}</span>
              {!fromHub ? <StatusBadge tone="neutral" label={ORIGIN_LABEL[install.origin] ?? install.origin} /> : null}
              {checking ? <StatusBadge tone="progress" label="Checking…" /> : null}
              {offer ? <StatusBadge tone="info" label={`${offer.availableVersion} available`} /> : null}
              {!offer && check?.status === "upToDate" ? <StatusBadge tone="active" label="Up to date" /> : null}
              {check?.status === "error" ? <StatusBadge tone="error" label="Check failed" /> : null}
            </div>
          </div>
          {offer ? (
            <Button className="shrink-0" type="button" size="lg" onClick={() => setReviewing(offer)}>
              <Eye aria-hidden="true" />
              Review update
            </Button>
          ) : fromHub ? (
            <Button className="shrink-0" type="button" variant="outline" size="lg" disabled={checking} onClick={() => void checkForUpdates()}>
              {checking ? <Loader2 className="animate-spin" aria-hidden="true" /> : <RefreshCw aria-hidden="true" />}
              Check for updates
            </Button>
          ) : null}
        </div>
        {check?.status === "error" ? <p className="m-0 text-sm text-destructive">{check.message}</p> : null}
        <TemplateUpdateReviewDialog projectId={projectId} offer={reviewing} onClose={() => setReviewing(null)} />
      </CardContent>
    </Card>
  );
}
