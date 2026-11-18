"use client";

import { useState } from "react";
import { Eye, EyeOff, KeyRound, Link2 } from "lucide-react";
import { Label } from "@/components/ui/label";

// The URL and API key fields of a service connection, the same for a Publisher
// and an Analytics Adapter: an icon in front of each, and the key can be shown.
// The icons are flex siblings of a bare input, so they never overlap the text.

const FIELD_CLASS =
  "flex h-10 w-full items-center gap-2 rounded-lg border border-input bg-transparent px-3 transition-colors focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 dark:bg-input/30";
const BARE_INPUT_CLASS = "h-full w-full min-w-0 border-0 bg-transparent p-0 text-base outline-none placeholder:text-muted-foreground md:text-sm";

export function ConnectionUrlField({ id, label, value, onChange }: { id: string; label: string; value: string; onChange: (value: string) => void }) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      <div className={FIELD_CLASS}>
        <Link2 className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <input id={id} name="url" className={BARE_INPUT_CLASS} autoComplete="off" placeholder="https://" value={value} onChange={(event) => onChange(event.target.value)} />
      </div>
    </div>
  );
}

export function ConnectionKeyField({ id, placeholder, value, onChange }: { id: string; placeholder: string; value: string; onChange: (value: string) => void }) {
  const [shown, setShown] = useState(false);
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>API key</Label>
      <div className={FIELD_CLASS}>
        <KeyRound className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <input id={id} name="apiKey" className={BARE_INPUT_CLASS} type={shown ? "text" : "password"} autoComplete="off" placeholder={placeholder} value={value} onChange={(event) => onChange(event.target.value)} />
        <button type="button" aria-label={shown ? "Hide API key" : "Show API key"} className="shrink-0 text-muted-foreground hover:text-foreground" onClick={() => setShown((v) => !v)}>
          {shown ? <EyeOff className="size-4" aria-hidden="true" /> : <Eye className="size-4" aria-hidden="true" />}
        </button>
      </div>
    </div>
  );
}
