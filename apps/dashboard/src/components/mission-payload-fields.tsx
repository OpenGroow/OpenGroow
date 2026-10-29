"use client";

import type { MissionPayloadField } from "@convex/template_manifest_contract";
import { isMissionPayloadFieldEmpty } from "../utils/mission-types";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";

type Props = {
  fields: MissionPayloadField[];
  payloadText: string;
  onChange: (nextPayloadText: string) => void;
};

/**
 * Generic Mission payload form, driven entirely by a Mission type's `fields`
 * schema (issue #300). Renders a text input or a select per declared field —
 * no branching on Mission type or Template id. The payload itself stays a
 * JSON string (`payloadText`), matching what `missions.create` /
 * `schedules.create` already expect; this component only changes how that
 * string gets edited.
 */
export function MissionPayloadFields({ fields, payloadText, onChange }: Props) {
  let payload: Record<string, unknown>;
  try {
    const parsed: unknown = payloadText.trim() ? JSON.parse(payloadText) : {};
    payload = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    payload = {};
  }

  function setField(key: string, value: string) {
    onChange(JSON.stringify({ ...payload, [key]: value }));
  }

  // A `type: "number"` field (see `MissionPayloadField` in agent-templates)
  // declares a JSON number, so the payload only ever holds a number under
  // that key. An empty — or unparsable — input clears the key entirely
  // rather than writing NaN, "" or the raw string: a string here would be
  // invisible in the input (which only renders numbers) while making
  // validation report the field as missing instead of malformed.
  function setNumberField(key: string, rawValue: string) {
    const next = { ...payload };
    const parsed = Number(rawValue);
    if (rawValue.trim() === "" || Number.isNaN(parsed)) {
      delete next[key];
    } else {
      next[key] = parsed;
    }
    onChange(JSON.stringify(next));
  }

  return (
    <div className="grid gap-4">
      {fields.map((field) => {
        const rawValue = payload[field.key];
        const value = isMissionPayloadFieldEmpty(field, rawValue) ? "" : String(rawValue);
        return (
          <label key={field.key} className="grid gap-1.5">
            <span className="text-sm font-semibold text-muted-foreground">
              {field.label}
              {field.required ? " *" : ""}
            </span>
            {field.type === "select" ? (
              <NativeSelect
                value={value}
                onChange={(e) => setField(field.key, e.target.value)}
                required={field.required}
              >
                {/* Always render an empty option, even when required: a <NativeSelect>
                    with value="" and no matching <option> silently falls back to
                    displaying the first real option (native browser behavior) —
                    but the underlying value stays "", so it *looks* filled in
                    while the payload is still empty (and required-field
                    validation fails without a visible reason). This forces the
                    displayed state and the payload to agree until the user
                    actually picks something. */}
                <option value="">{field.required ? "— Select —" : "—"}</option>
                {field.options.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </NativeSelect>
            ) : field.type === "number" ? (
              <Input
                type="number"
                value={value}
                min={field.min}
                max={field.max}
                onChange={(e) => setNumberField(field.key, e.target.value)}
                required={field.required}
              />
            ) : (
              <Input
                type="text"
                value={value}
                onChange={(e) => setField(field.key, e.target.value)}
                required={field.required}
              />
            )}
          </label>
        );
      })}
    </div>
  );
}
