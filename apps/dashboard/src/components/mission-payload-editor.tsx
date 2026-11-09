"use client";

import type { MissionPayloadField } from "@convex/template_manifest_contract";
import { MissionPayloadFields } from "./mission-payload-fields";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

type Props = {
  /** The selected Mission type's declared field schema, if any. */
  fields: MissionPayloadField[] | undefined;
  payloadText: string;
  onChange: (nextPayloadText: string) => void;
  /**
   * Raw-JSON escape hatch (issue #300). When a Mission type declares `fields`,
   * the operator can still flip to a raw JSON textarea to bypass the generic
   * form and its per-field validation. The mode is owned by the parent so the
   * submit handler can skip `validateMissionPayload` while raw mode is active.
   */
  rawMode: boolean;
  onRawModeChange: (rawMode: boolean) => void;
};

/**
 * Edits a Mission payload: the Mission type's declared `fields` (issue #300)
 * are shown inline, and a discreet "Edit as raw JSON" opens the whole payload
 * as JSON — for options the Template does not declare as fields, or for a
 * type that declares none. Shared by Mission creation and Schedule
 * creation/editing so the two surfaces never drift.
 */
export function MissionPayloadEditor({ fields, payloadText, onChange, rawMode, onRawModeChange }: Props) {
  const hasFields = !!fields && fields.length > 0;

  if (!rawMode) {
    return (
      <div className="grid gap-2">
        {hasFields ? <MissionPayloadFields fields={fields} payloadText={payloadText} onChange={onChange} /> : null}
        <Button variant="ghost" size="sm" type="button" className="-ml-3 w-fit" onClick={() => onRawModeChange(true)}>
          Edit as raw JSON
        </Button>
      </div>
    );
  }

  return (
    <div className="grid gap-2">
      <Textarea
        aria-label="Payload (JSON)"
        value={payloadText}
        onChange={(e) => onChange(e.target.value)}
        rows={3}
        placeholder='{"url": "https://example.com"}'
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        className="font-mono"
      />
      <Button variant="ghost" size="sm" type="button" className="-ml-3 w-fit" onClick={() => onRawModeChange(false)}>
        {hasFields ? "Back to form" : "Hide raw JSON"}
      </Button>
    </div>
  );
}
