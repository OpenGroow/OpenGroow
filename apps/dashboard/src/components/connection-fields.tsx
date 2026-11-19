"use client";

import { useRef, useState } from "react";
import { Eye, EyeOff, FileJson, KeyRound, Link2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

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

/**
 * The secret of a connection that is a JSON document (a service account key): a multi-line field and a
 * "Choose a file" button that only fills the field, in the browser. The page never shows a saved value.
 */
export function ConnectionJsonSecretField({ id, label, placeholder, value, onChange }: { id: string; label: string; placeholder: string; value: string; onChange: (value: string) => void }) {
  const [fileError, setFileError] = useState<string | null>(null);
  const picker = useRef<HTMLInputElement>(null);
  async function fillFrom(file: File | undefined) {
    if (!file) return;
    try {
      onChange(
        await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = () => reject(reader.error);
          reader.readAsText(file);
        }),
      );
      setFileError(null);
    } catch {
      setFileError("Could not read the file");
    }
  }
  return (
    <div className="grid gap-2 md:col-span-2">
      <Label htmlFor={id}>{label}</Label>
      <Textarea
        id={id}
        name="apiKey"
        rows={6}
        spellCheck={false}
        autoComplete="off"
        className="font-mono"
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      <div className="flex items-center gap-3">
        <Button type="button" variant="link" size="sm" className="px-0" onClick={() => picker.current?.click()}>
          <FileJson aria-hidden="true" />
          Choose a file
        </Button>
        <Input ref={picker} type="file" accept=".json,application/json" className="sr-only" tabIndex={-1} aria-label="Choose a JSON file" onChange={(event) => void fillFrom(event.target.files?.[0])} />
        {fileError ? <span className="text-sm text-destructive">{fileError}</span> : null}
      </div>
    </div>
  );
}

export function ConnectionKeyField({ id, label = "API key", placeholder, value, onChange }: { id: string; label?: string; placeholder: string; value: string; onChange: (value: string) => void }) {
  const [shown, setShown] = useState(false);
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      <div className={FIELD_CLASS}>
        <KeyRound className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <input id={id} name="apiKey" className={BARE_INPUT_CLASS} type={shown ? "text" : "password"} autoComplete="off" placeholder={placeholder} value={value} onChange={(event) => onChange(event.target.value)} />
        <Button type="button" variant="ghost" size="icon-xs" aria-label={shown ? "Hide API key" : "Show API key"} className="text-muted-foreground" onClick={() => setShown((v) => !v)}>
          {shown ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
        </Button>
      </div>
    </div>
  );
}
