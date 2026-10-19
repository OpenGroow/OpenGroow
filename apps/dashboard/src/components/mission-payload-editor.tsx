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
 * Chooses how a Mission payload is edited: a generic per-field form when the
 * Mission type declares `fields` (issue #300), otherwise the raw JSON textarea.
 * A raw-JSON toggle stays available even when `fields` is declared, so nothing
 * about the payload is ever un-editable. Shared by Mission creation and
 * Schedule creation/editing so the two surfaces never drift.
 */
export function MissionPayloadEditor({ fields, payloadText, onChange, rawMode, onRawModeChange }: Props) {
  const hasFields = !!fields && fields.length > 0;

  if (hasFields && !rawMode) {
    return (
      <div className="grid gap-2">
        <MissionPayloadFields fields={fields} payloadText={payloadText} onChange={onChange} />
        <Button variant="outline" size="sm" type="button" onClick={() => onRawModeChange(true)} >
          Edit as raw JSON
        </Button>
      </div>
    );
  }

  return (
    <div className="grid gap-2">
      <label className="grid gap-1.5">
        <span className="text-sm font-semibold text-muted-foreground">Payload (JSON, optional)</span>
        <Textarea
          value={payloadText}
          onChange={(e) => onChange(e.target.value)}
          rows={3}
          placeholder='{"url": "https://example.com"}'
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          className="font-mono"
        />
      </label>
      {hasFields ? (
        <Button variant="outline" size="sm" type="button" onClick={() => onRawModeChange(false)} >
          Back to form
        </Button>
      ) : null}
    </div>
  );
}
