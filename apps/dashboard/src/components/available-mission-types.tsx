"use client";

import * as React from "react";
import { Loader2 } from "lucide-react";
import type { MissionType } from "@convex/template_manifest_contract";
import { Button } from "@/components/ui/button";

/**
 * Lets the operator choose which of the Template's Mission types this Agent
 * offers (ADR-053). The UI shows what is available (checked = visible) while
 * the stored value stays a deny-list: `onApply` receives the unchecked types.
 */
export function AvailableMissionTypes({
  missionTypes,
  hidden,
  saving,
  onApply,
}: {
  missionTypes: MissionType[];
  hidden: readonly string[] | undefined;
  saving: boolean;
  onApply: (hiddenMissionTypes: string[]) => void;
}) {
  // Only types the Template still declares count; stale names are ignored.
  const storedVisible = React.useMemo(
    () => missionTypes.filter((t) => !hidden?.includes(t.type)).map((t) => t.type),
    [missionTypes, hidden],
  );
  const [draft, setDraft] = React.useState<string[]>(storedVisible);
  React.useEffect(() => setDraft(storedVisible), [storedVisible]);

  const nextHidden = missionTypes.filter((t) => !draft.includes(t.type)).map((t) => t.type);
  const nextVisible = missionTypes.filter((t) => draft.includes(t.type)).map((t) => t.type);
  const changed =
    nextVisible.length !== storedVisible.length || nextVisible.some((type, index) => type !== storedVisible[index]);

  function toggle(type: string, checked: boolean) {
    setDraft((prev) => (checked ? [...prev, type] : prev.filter((candidate) => candidate !== type)));
  }

  return (
    <fieldset className="m-0 grid gap-3 rounded-xl border border-[rgba(0,38,27,0.12)] px-4 py-3">
      <legend className="px-1 text-[0.8rem] font-semibold text-[var(--dashboard-ink-soft)]">
        Available Mission types
      </legend>
      <p className="m-0 text-[0.85rem] text-[var(--dashboard-ink-muted)]">
        Unchecked types are not offered in Create Mission and Create Schedule, and their instructions are removed from
        the workspace.
      </p>
      {missionTypes.map((missionType) => (
        <label key={missionType.type} className="flex items-start gap-2.5 text-[0.9rem] text-[var(--dashboard-ink)]">
          <input
            type="checkbox"
            className="mt-1 h-4 w-4 rounded border-[rgba(0,38,27,0.24)] focus:ring-2 focus:ring-[var(--dashboard-primary)] disabled:opacity-50"
            checked={draft.includes(missionType.type)}
            disabled={saving}
            onChange={(event) => toggle(missionType.type, event.target.checked)}
          />
          {missionType.label}
        </label>
      ))}
      <div>
        <Button
          type="button"
          disabled={saving || !changed}
          onClick={() => onApply(nextHidden)}
          className="h-10 rounded-xl border border-[rgba(0,38,27,0.12)] bg-white px-4 font-semibold text-[var(--dashboard-ink)] hover:bg-[rgba(220,230,224,0.5)]"
        >
          {saving ? (
            <span className="flex items-center gap-2">
              <Loader2 className="size-4 animate-spin" />
              Applying…
            </span>
          ) : (
            "Apply"
          )}
        </Button>
      </div>
    </fieldset>
  );
}
