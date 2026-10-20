"use client";

import * as React from "react";
import { ListChecks } from "lucide-react";
import type { MissionType } from "@convex/template_manifest_contract";
import { Checkbox } from "@/components/ui/checkbox";
import { SettingsPanel } from "@/components/opengroow/settings-panel";

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
    <SettingsPanel
      icon={ListChecks}
      tone="violet"
      title="Available Mission types"
      description="Choose which Missions this Agent can perform. Unchecked types are not offered in Create Mission and Create Schedule, and their instructions are removed from the workspace."
      dirty={changed}
      saving={saving}
      onSave={() => onApply(nextHidden)}
      onCancel={() => setDraft(storedVisible)}
    >
      <ul className="m-0 grid list-none gap-5 rounded-xl border border-border p-5">
        {missionTypes.map((missionType) => (
          <li key={missionType.type}>
            <label className="flex items-start gap-3 text-base text-foreground">
              <Checkbox
                className="mt-0.5"
                checked={draft.includes(missionType.type)}
                disabled={saving}
                onCheckedChange={(checked) => toggle(missionType.type, checked)}
              />
              <span className="grid gap-0.5">
                <span>{missionType.label}</span>
                {missionType.description ? (
                  <span className="text-sm text-muted-foreground">{missionType.description}</span>
                ) : null}
              </span>
            </label>
          </li>
        ))}
      </ul>
    </SettingsPanel>
  );
}
