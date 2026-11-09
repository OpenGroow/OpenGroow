"use client";

import { useEffect, useRef, useState } from "react";
import type { MissionPayloadField } from "@convex/template_manifest_contract";
import { MissionPayloadFields } from "./mission-payload-fields";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

type Props = {
  /** The selected Mission type's declared field schema, if any. */
  fields: MissionPayloadField[] | undefined;
  /** Payload keys another control of the form edits (e.g. the publish picker's `publishTargets`). */
  reservedKeys?: readonly string[];
  payloadText: string;
  onChange: (nextPayloadText: string) => void;
  /** Whether the raw JSON of the extra options is open; owned by the parent, which closes it on a type change. */
  rawMode: boolean;
  onRawModeChange: (rawMode: boolean) => void;
};

type Payload = Record<string, unknown>;

function parseObject(text: string): Payload | null {
  if (!text.trim()) return {};
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Payload) : null;
  } catch {
    return null;
  }
}

function split(payload: Payload, managed: ReadonlySet<string>): { managedPart: Payload; extras: Payload } {
  const managedPart: Payload = {};
  const extras: Payload = {};
  for (const [key, value] of Object.entries(payload)) (managed.has(key) ? managedPart : extras)[key] = value;
  return { managedPart, extras };
}

/**
 * Edits a Mission payload: the Mission type's declared `fields` (issue #300)
 * are shown inline, and a discreet "Edit as raw JSON" opens only the extra
 * options — the keys no field and no other control of the form edits. Shared
 * by Mission creation and Schedule creation/editing so the two never drift.
 */
export function MissionPayloadEditor({ fields, reservedKeys, payloadText, onChange, rawMode, onRawModeChange }: Props) {
  const hasFields = !!fields && fields.length > 0;
  const managed = new Set([...(fields ?? []).map((field) => field.key), ...(reservedKeys ?? [])]);

  return (
    <div className="grid gap-2">
      {hasFields ? <MissionPayloadFields fields={fields} payloadText={payloadText} onChange={onChange} /> : null}
      {rawMode ? <ExtraOptionsJson managed={managed} payloadText={payloadText} onChange={onChange} /> : null}
      <Button variant="ghost" size="sm" type="button" className="-ml-3 w-fit" onClick={() => onRawModeChange(!rawMode)}>
        {rawMode ? "Hide raw JSON" : "Edit as raw JSON"}
      </Button>
    </div>
  );
}

/**
 * The extra options as JSON. Its text is local (seeded when opened) so a
 * half-typed edit never wipes the fields; only valid JSON is merged into the
 * payload, and invalid JSON blocks the form's submission.
 */
function ExtraOptionsJson({ managed, payloadText, onChange }: { managed: ReadonlySet<string>; payloadText: string; onChange: (next: string) => void }) {
  const [text, setText] = useState(() => {
    const { extras } = split(parseObject(payloadText) ?? {}, managed);
    return Object.keys(extras).length ? JSON.stringify(extras, null, 2) : "";
  });
  const invalid = parseObject(text) === null;
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    ref.current?.setCustomValidity(invalid ? "Invalid JSON: expected an object." : "");
  }, [invalid]);

  function edit(nextText: string) {
    setText(nextText);
    const extras = parseObject(nextText);
    if (!extras) return;
    const { managedPart } = split(parseObject(payloadText) ?? {}, managed);
    const merged = { ...split(extras, managed).extras, ...managedPart };
    onChange(Object.keys(merged).length ? JSON.stringify(merged) : "");
  }

  return (
    <div className="grid gap-1.5">
      <Textarea
        ref={ref}
        aria-label="Extra options (JSON)"
        aria-invalid={invalid}
        value={text}
        onChange={(e) => edit(e.target.value)}
        rows={3}
        placeholder='{"url": "https://example.com"}'
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        className="font-mono"
      />
      {invalid ? <p className="text-xs text-destructive">Invalid JSON: expected an object.</p> : null}
    </div>
  );
}
