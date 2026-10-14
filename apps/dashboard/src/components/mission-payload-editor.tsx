"use client";

import type { MissionPayloadField } from "@convex/template_manifest_contract";
import { MissionPayloadFields } from "./mission-payload-fields";

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

const TOGGLE_CLASS =
  "justify-self-start text-[0.78rem] font-semibold text-[var(--dashboard-primary)] underline underline-offset-2";

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
        <button type="button" onClick={() => onRawModeChange(true)} className={TOGGLE_CLASS}>
          Edit as raw JSON
        </button>
      </div>
    );
  }

  return (
    <div className="grid gap-2">
      <label className="grid gap-1.5">
        <span className="text-[0.82rem] font-semibold text-[var(--dashboard-ink-soft)]">Payload (JSON, optional)</span>
        <textarea
          value={payloadText}
          onChange={(e) => onChange(e.target.value)}
          rows={5}
          placeholder='{"url": "https://example.com"}'
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          className="rounded-xl border border-[rgba(0,38,27,0.12)] bg-white px-3 py-2.5 font-mono text-[0.88rem] text-[var(--dashboard-ink)] placeholder:font-sans placeholder:text-[var(--dashboard-ink-soft)] focus:outline-none focus:ring-2 focus:ring-[var(--dashboard-primary)]"
        />
      </label>
      {hasFields ? (
        <button type="button" onClick={() => onRawModeChange(false)} className={TOGGLE_CLASS}>
          Back to form
        </button>
      ) : null}
    </div>
  );
}
