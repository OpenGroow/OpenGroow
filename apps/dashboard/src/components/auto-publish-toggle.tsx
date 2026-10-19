"use client";

import type { AgentManifest } from "@convex/template_manifest_contract";
import { templateSupportsAutoPublish } from "@convex/template_manifest_contract";

/**
 * Whether the `autoPublish` toggle should be offered at all: the Template the
 * Mission runs on must declare a review contract with the full
 * `to_validate` -> `approved` flow for that mission type (issue #328).
 * Returns false for an unknown template — its capability can't be derived.
 */
export function supportsAutoPublish(
  manifests: AgentManifest[],
  templateId: string,
  missionType: string,
): boolean {
  const manifest = manifests.find((m) => m.id === templateId);
  return manifest ? templateSupportsAutoPublish(manifest, missionType) : false;
}

export const AUTO_PUBLISH_HINT =
  "Automatically approve and publish once ready for review — no manual validation step.";

/** Same toggle, but stated as the default inherited by every Mission a Schedule creates (issue #330). */
export const AUTO_PUBLISH_SCHEDULE_HINT =
  "Every Mission this Schedule creates will automatically approve and publish once ready for review.";

/**
 * Single rendering of the `autoPublish` checkbox, shared by the Mission
 * creation form and the Mission detail page so the label and copy can't drift.
 */
export function AutoPublishToggle({
  checked,
  disabled = false,
  hint = AUTO_PUBLISH_HINT,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  hint?: string;
  onChange: (next: boolean) => void;
}) {
  return (
    <label className="flex items-start gap-2.5">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-1 h-4 w-4 rounded border-border text-primary focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
      />
      <span className="grid gap-0.5">
        <span className="text-sm font-semibold text-muted-foreground">
          Auto-publish
        </span>
        <span className="text-xs text-muted-foreground">{hint}</span>
      </span>
    </label>
  );
}
