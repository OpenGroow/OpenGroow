"use client";

import { TriangleAlert } from "lucide-react";
import { isTemplateVersionRunnable, type AgentManifest } from "@convex/template_manifest_contract";

/** Whether the installed version of a Template is outdated (ADR-091): readable, but nothing new starts from it. */
export function isTemplateOutdated(manifest: Pick<AgentManifest, "schemaVersion"> | undefined | null): boolean {
  return manifest ? !isTemplateVersionRunnable(manifest) : false;
}

/** The reason Create Mission and Run now give while the Template is outdated. */
export const OUTDATED_TEMPLATE_REASON =
  "This Template is outdated: update it before creating or running anything new. Existing content stays readable and can still be approved and published.";

/** The label of a Schedule whose Template is outdated: it skips its occurrences and resumes after the update. */
export const OUTDATED_SCHEDULE_LABEL = "Template outdated, update to resume";

/** Says that a Template is outdated and what to do, with the offered update reachable from the same page. */
export function OutdatedTemplateNotice({ names, className }: { names?: readonly string[]; className?: string }) {
  return (
    <section
      role="status"
      data-testid="outdated-template-notice"
      className={`flex items-start gap-3 rounded-xl border border-status-warning/30 bg-status-warning/10 p-4 ${className ?? ""}`}
    >
      <TriangleAlert aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-status-warning" />
      <div className="grid min-w-0 gap-1">
        <h2 className="m-0 text-base font-semibold text-status-warning">
          {names && names.length > 0 ? `Update needed: ${names.join(", ")}` : "Update needed"}
        </h2>
        <p className="m-0 text-sm text-status-warning">{OUTDATED_TEMPLATE_REASON}</p>
      </div>
    </section>
  );
}
