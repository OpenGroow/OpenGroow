"use client";

import type { FunctionReturnType } from "convex/server";
import { api } from "@convex/_generated/api";
import type { AgentManifest, InstallationPlan } from "@convex/template_manifest_contract";
import { ActivationDialog } from "@/src/components/activation-dialog";
import { MachinePrerequisiteList } from "@/src/components/machine-prerequisites";
import { Button } from "@/components/ui/button";

export type Verification = FunctionReturnType<typeof api.project_templates_node.hubCatalogue>["entries"][number]["verification"];

const TRUST_LABELS: Record<Verification, string> = {
  official: "Official",
  verified: "Verified",
  community: "Community",
};

const TRUST_CLASSES: Record<Verification, string> = {
  official: "bg-[rgba(0,38,27,0.10)] text-[var(--dashboard-primary)]",
  verified: "bg-[rgba(30,100,200,0.10)] text-[rgb(30,80,160)]",
  community: "bg-[rgba(0,0,0,0.06)] text-[var(--dashboard-ink-muted)]",
};

export function TrustBadge({ verification }: { verification: Verification }) {
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[0.7rem] font-semibold uppercase tracking-[0.08em] ${TRUST_CLASSES[verification]}`}
    >
      {TRUST_LABELS[verification]}
    </span>
  );
}

export function CatalogueItem({
  name,
  description,
  meta,
  trust,
  busy = false,
  onChoose,
}: {
  name: string;
  description: string;
  meta: string;
  trust: Verification | null;
  busy?: boolean;
  onChoose: () => void;
}) {
  return (
    <li className="grid gap-2 rounded-xl border border-[rgba(0,38,27,0.10)] p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="grid gap-1">
          <span className="flex items-center gap-2 font-semibold text-[var(--dashboard-ink)]">
            {name}
            {trust ? <TrustBadge verification={trust} /> : null}
          </span>
          <span className="text-[0.8rem] text-[var(--dashboard-ink-soft)]">{meta}</span>
        </div>
        <Button type="button" variant="outline" disabled={busy} onClick={onChoose}>
          Choose<span className="sr-only"> {name}</span>
        </Button>
      </div>
      <p className="m-0 text-[0.9rem] leading-6 text-[var(--dashboard-ink-muted)]">{description}</p>
    </li>
  );
}

function PlanSummary({ plan }: { plan: InstallationPlan }) {
  const sections: { title: string; items: string[] }[] = [
    { title: "MCP hosts called", items: plan.mcpHosts },
    {
      title: "Secrets requested",
      items: plan.secrets.map((secret) => (secret.required ? secret.label : `${secret.label} (optional)`)),
    },
    { title: "Skills installed", items: plan.skills },
  ];
  return (
    <div className="grid gap-3 rounded-xl bg-[rgba(0,38,27,0.04)] p-4">
      {sections.map(({ title, items }) => (
        <div key={title} className="grid gap-1">
          <span className="text-[0.75rem] font-bold uppercase tracking-[0.14em] text-[var(--dashboard-ink-soft)]">
            {title}
          </span>
          {items.length === 0 ? (
            <span className="text-[0.9rem] text-[var(--dashboard-ink-muted)]">None</span>
          ) : (
            <ul className="m-0 grid list-none gap-0.5 p-0 text-[0.9rem] text-[var(--dashboard-ink)]">
              {items.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          )}
        </div>
      ))}
      <div className="grid gap-1">
        <span className="text-[0.75rem] font-bold uppercase tracking-[0.14em] text-[var(--dashboard-ink-soft)]">
          Install on your machine
        </span>
        {plan.prerequisites.length === 0 ? (
          <span className="text-[0.9rem] text-[var(--dashboard-ink-muted)]">None</span>
        ) : (
          <MachinePrerequisiteList prerequisites={plan.prerequisites} />
        )}
      </div>
    </div>
  );
}

/** The confirm step of adding an Agent: what it will do in the Project, then install and activate. */
export function PlanActivationDialog({
  choice,
  onOpenChange,
  onSubmit,
}: {
  choice: { manifest: AgentManifest; plan: InstallationPlan };
  onOpenChange: (open: boolean) => void;
  onSubmit: (userConfig: Record<string, string>) => Promise<void>;
}) {
  return (
    <ActivationDialog
      manifest={choice.manifest}
      open
      title={`Add ${choice.manifest.name}`}
      description="Review what this agent will do in your Project, then confirm to install and activate it."
      submitLabel="Install and activate"
      preface={<PlanSummary plan={choice.plan} />}
      onOpenChange={onOpenChange}
      onSubmit={onSubmit}
    />
  );
}
