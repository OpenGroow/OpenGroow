"use client";

import type { FunctionReturnType } from "convex/server";
import { api } from "@convex/_generated/api";
import type { AgentManifest, InstallationPlan } from "@convex/template_manifest_contract";
import { ActivationDialog } from "@/src/components/activation-dialog";
import { MachinePrerequisiteList } from "@/src/components/machine-prerequisites";
import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export type Verification = FunctionReturnType<typeof api.project_templates_node.hubCatalogue>["entries"][number]["verification"];

const TRUST_LABELS: Record<Verification, string> = {
  official: "Official",
  verified: "Verified",
  community: "Community",
};

const TRUST_VARIANTS: Record<Verification, BadgeVariant> = {
  official: "default",
  verified: "default",
  community: "outline",
};

export function TrustBadge({ verification }: { verification: Verification }) {
  return <Badge variant={TRUST_VARIANTS[verification]}>{TRUST_LABELS[verification]}</Badge>;
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
    <li>
      <Card className="gap-2 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="grid gap-1">
          <span className="flex items-center gap-2 font-semibold text-foreground">
            {name}
            {trust ? <TrustBadge verification={trust} /> : null}
          </span>
          <span className="text-xs text-muted-foreground">{meta}</span>
        </div>
        <Button type="button" variant="outline" disabled={busy} onClick={onChoose}>
          Choose<span className="sr-only"> {name}</span>
        </Button>
      </div>
      <p className="m-0 text-sm leading-6 text-muted-foreground">{description}</p>
    </Card>
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
    <div className="grid gap-3 rounded-xl bg-muted p-4">
      {sections.map(({ title, items }) => (
        <div key={title} className="grid gap-1">
          <span className="text-xs font-semibold text-muted-foreground">
            {title}
          </span>
          {items.length === 0 ? (
            <span className="text-sm text-muted-foreground">None</span>
          ) : (
            <ul className="m-0 grid list-none gap-0.5 p-0 text-sm text-foreground">
              {items.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          )}
        </div>
      ))}
      <div className="grid gap-1">
        <span className="text-xs font-semibold text-muted-foreground">
          Install on your machine
        </span>
        {plan.prerequisites.length === 0 ? (
          <span className="text-sm text-muted-foreground">None</span>
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
