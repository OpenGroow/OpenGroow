"use client";

import * as React from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { Loader2, RefreshCw } from "lucide-react";
import type { FunctionReturnType } from "convex/server";
import { api } from "@convex/_generated/api";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export type UpdateOffer = FunctionReturnType<typeof api.project_templates.updates>[number];
type Section = { title: string; items: string[]; warning?: boolean };

/** Every kind of change an update plan lists, as readable sections (empty ones are dropped). */
export function planSections(offer: UpdateOffer): Section[] {
  const { plan } = offer;
  const sections: Section[] = [
    { title: "MCP hosts added", items: plan.mcpHosts.added },
    { title: "MCP hosts removed", items: plan.mcpHosts.removed },
    {
      title: "MCP servers moved to another host",
      items: plan.mcpHosts.changed.map((c) => `${c.server}: ${c.from.join(", ")} → ${c.to.join(", ")}`),
    },
    {
      title: "New secrets requested",
      items: plan.newSecrets.map((s) => (s.required ? s.label : `${s.label} (optional)`)),
    },
    { title: "New plugins installed", items: plan.newPlugins },
    { title: "New skills installed", items: plan.newSkills },
    { title: "New required fields", items: plan.newRequiredFields.map((f) => f.label) },
    { title: "Fields requiring re-activation", items: plan.reactivationFields.map((f) => f.label) },
    { title: "Mission types removed", items: plan.removedMissionTypes },
    {
      title: "Removed Mission types still used by a Schedule",
      items: plan.removedMissionTypesInUse.map((u) => `${u.type} (${u.schedules} ${u.schedules === 1 ? "Schedule" : "Schedules"})`),
      warning: true,
    },
  ];
  return sections.filter((section) => section.items.length > 0);
}

/**
 * The update plan of an offered version, to review before confirming (#669):
 * nothing is applied until "Apply update"; Missions in progress keep their version.
 */
export function TemplateUpdateReviewDialog({
  projectId,
  offer,
  onClose,
}: {
  projectId: string;
  offer: UpdateOffer | null;
  onClose: () => void;
}) {
  const applyUpdate = useMutation(api.project_templates.applyUpdate);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);

  function close() {
    setError(null);
    onClose();
  }

  async function confirm(reviewing: UpdateOffer) {
    setPending(true);
    setError(null);
    try {
      await applyUpdate({ projectId, templateId: reviewing.templateId, version: reviewing.availableVersion });
      close();
    } catch (err) {
      setError(err instanceof Error ? err.message : "The update could not be applied");
    } finally {
      setPending(false);
    }
  }

  const sections = offer ? planSections(offer) : [];
  return (
    <Dialog open={offer !== null} onOpenChange={(open) => !open && close()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            Update {offer?.templateId} to {offer?.availableVersion}
          </DialogTitle>
          <DialogDescription>
            Nothing changes until you confirm. Missions already in progress keep running version{" "}
            {offer?.currentVersion}.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 rounded-xl bg-muted p-4">
          {sections.length === 0 ? (
            <span className="text-sm text-muted-foreground">
              No change to hosts, secrets, plugins, required configuration or Mission types.
            </span>
          ) : (
            sections.map(({ title, items, warning }) => (
              <div key={title} className="grid gap-1">
                <span
                  className={`text-xs font-semibold ${
                    warning ? "text-destructive" : "text-muted-foreground"
                  }`}
                >
                  {title}
                </span>
                <ul className="m-0 grid list-none gap-0.5 p-0 text-sm text-foreground">
                  {items.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            ))
          )}
        </div>
        {error ? (
          <p role="alert" className="m-0 text-sm text-destructive">
            {error}
          </p>
        ) : null}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={close}>
            Cancel
          </Button>
          <Button type="button" disabled={pending} onClick={() => offer && void confirm(offer)}>
            Apply update
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Tells the Project a newer version of an installed Template is available and
 * lets the user review its update plan before confirming (#669).
 */
export function TemplateUpdatesPanel({ projectId }: { projectId: string }) {
  const offers = useQuery(api.project_templates.updates, { projectId });
  const [reviewing, setReviewing] = React.useState<UpdateOffer | null>(null);

  if (!offers || offers.length === 0) return null;

  return (
    <>
      <ul className="m-0 grid list-none gap-3 p-0" aria-label="Template updates">
        {offers.map((offer) => (
          <li
            key={offer.templateId}
            className="flex items-center justify-between gap-3 rounded-xl border border-border bg-muted p-4"
          >
            <span className="text-sm text-foreground">
              Version {offer.availableVersion} of {offer.templateId} is available (installed: {offer.currentVersion}).
            </span>
            <Button type="button" variant="outline" onClick={() => setReviewing(offer)}>
              Review update<span className="sr-only"> of {offer.templateId}</span>
            </Button>
          </li>
        ))}
      </ul>
      <TemplateUpdateReviewDialog projectId={projectId} offer={reviewing} onClose={() => setReviewing(null)} />
    </>
  );
}

/**
 * Asks the hub, on demand, for newer versions of the Project's hub Templates
 * (`checkHubUpdates`): a newer one is offered (not applied) and appears in
 * `TemplateUpdatesPanel`. The hub is read only when the button is clicked.
 */
export function CheckTemplateUpdatesButton({ projectId }: { projectId: string }) {
  const offers = useQuery(api.project_templates.updates, { projectId });
  const checkHubUpdates = useAction(api.project_templates_node.checkHubUpdates);
  const [state, setState] = React.useState<{ status: "checking" | "done" | "error"; message?: string } | null>(null);

  async function check() {
    setState({ status: "checking" });
    try {
      const result = await checkHubUpdates({ instanceId: projectId });
      if (result.error) {
        setState({ status: "error", message: result.error });
        return;
      }
      // An update offered earlier and not applied yet is still available.
      const available = result.offered.length > 0 || (offers?.length ?? 0) > 0;
      setState({ status: "done", message: available ? "Updates available below" : "Up to date" });
    } catch (error) {
      setState({ status: "error", message: error instanceof Error ? error.message : "The hub could not be read" });
    }
  }

  const checking = state?.status === "checking";
  return (
    <>
      {state && !checking ? (
        <span className={`text-sm ${state.status === "error" ? "text-destructive" : "text-muted-foreground"}`}>{state.message}</span>
      ) : null}
      <Button type="button" variant="outline" size="lg" disabled={checking} onClick={() => void check()}>
        {checking ? <Loader2 className="animate-spin" aria-hidden="true" /> : <RefreshCw aria-hidden="true" />}
        Check for updates
      </Button>
    </>
  );
}
