"use client";

import * as React from "react";
import { useMutation, useQuery } from "convex/react";
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

type UpdateOffer = FunctionReturnType<typeof api.project_templates.updates>[number];
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
 * Tells the Project a newer version of an installed Template is available and
 * lets the user review its update plan before confirming (#669). Nothing is
 * applied until "Apply update"; Missions in progress keep their version.
 */
export function TemplateUpdatesPanel({ projectId }: { projectId: string }) {
  const offers = useQuery(api.project_templates.updates, { projectId });
  const applyUpdate = useMutation(api.project_templates.applyUpdate);
  const [reviewing, setReviewing] = React.useState<UpdateOffer | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);

  if (!offers || offers.length === 0) return null;

  function close() {
    setReviewing(null);
    setError(null);
  }

  async function confirm(offer: UpdateOffer) {
    setPending(true);
    setError(null);
    try {
      await applyUpdate({ projectId, templateId: offer.templateId, version: offer.availableVersion });
      setReviewing(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "The update could not be applied");
    } finally {
      setPending(false);
    }
  }

  const sections = reviewing ? planSections(reviewing) : [];

  return (
    <>
      <ul className="m-0 grid list-none gap-3 p-0" aria-label="Template updates">
        {offers.map((offer) => (
          <li
            key={offer.templateId}
            className="flex items-center justify-between gap-3 rounded-xl border border-[rgba(0,38,27,0.10)] bg-[rgba(0,38,27,0.04)] p-4"
          >
            <span className="text-[0.95rem] text-[var(--dashboard-ink)]">
              Version {offer.availableVersion} of {offer.templateId} is available (installed: {offer.currentVersion}).
            </span>
            <Button type="button" variant="outline" onClick={() => setReviewing(offer)}>
              Review update<span className="sr-only"> of {offer.templateId}</span>
            </Button>
          </li>
        ))}
      </ul>

      <Dialog open={reviewing !== null} onOpenChange={(open) => !open && close()}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              Update {reviewing?.templateId} to {reviewing?.availableVersion}
            </DialogTitle>
            <DialogDescription>
              Nothing changes until you confirm. Missions already in progress keep running version{" "}
              {reviewing?.currentVersion}.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 rounded-xl bg-[rgba(0,38,27,0.04)] p-4">
            {sections.length === 0 ? (
              <span className="text-[0.9rem] text-[var(--dashboard-ink-muted)]">
                No change to hosts, secrets, plugins, required configuration or Mission types.
              </span>
            ) : (
              sections.map(({ title, items, warning }) => (
                <div key={title} className="grid gap-1">
                  <span
                    className={`text-[0.75rem] font-bold uppercase tracking-[0.14em] ${
                      warning ? "text-[var(--dashboard-danger,#b42318)]" : "text-[var(--dashboard-ink-soft)]"
                    }`}
                  >
                    {title}
                  </span>
                  <ul className="m-0 grid list-none gap-0.5 p-0 text-[0.9rem] text-[var(--dashboard-ink)]">
                    {items.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </div>
              ))
            )}
          </div>
          {error ? (
            <p role="alert" className="m-0 text-[0.9rem] text-[var(--dashboard-danger,#b42318)]">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={close}>
              Cancel
            </Button>
            <Button type="button" disabled={pending} onClick={() => reviewing && void confirm(reviewing)}>
              Apply update
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
