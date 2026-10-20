"use client";

import * as React from "react";
import type { AgentManifest, LeafRequirementField, RequirementField } from "@convex/template_manifest_contract";
import { flattenRequirementFields, resolveLabelTokens } from "@convex/template_manifest_contract";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect } from "@/components/ui/native-select";

type ActivationDialogProps = {
  manifest: AgentManifest;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (userConfig: Record<string, string>) => void | Promise<void>;
  initialValues?: Record<string, string>;
  readOnlyKeys?: string[];
  title?: string;
  /** Replaces the default description under the title. */
  description?: string;
  submitLabel?: string;
  /** Shown above the form fields, e.g. the installation plan of an Agent being added. */
  preface?: React.ReactNode;
};

const EMPTY_REQUIREMENTS: RequirementField[] = [];

export function ActivationDialog({
  manifest,
  open,
  onOpenChange,
  onSubmit,
  initialValues,
  readOnlyKeys,
  title,
  description,
  submitLabel,
  preface,
}: ActivationDialogProps) {
  const requirements = manifest.requirements ?? EMPTY_REQUIREMENTS;
  const readOnlySet = React.useMemo(() => new Set(readOnlyKeys ?? []), [readOnlyKeys]);
  // Flattened once per requirements change (not per field per render) — both
  // submitDisabled and resolveLabelTokens (the `({key})` label grammar,
  // issue #345) walk the same flattened field list/lookup.
  const flatFields = React.useMemo(() => flattenRequirementFields(requirements), [requirements]);
  const fieldsByKey = React.useMemo(
    () => new Map(flatFields.map((field) => [field.key, field])),
    [flatFields],
  );
  const [values, setValues] = React.useState<Record<string, string>>(() =>
    buildInitialValues(requirements, initialValues),
  );
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [submitError, setSubmitError] = React.useState<string | null>(null);
  const wasOpenRef = React.useRef(open);

  React.useEffect(() => {
    if (open && !wasOpenRef.current) {
      setValues(buildInitialValues(requirements, initialValues));
      setSubmitError(null);
    }
    wasOpenRef.current = open;
  }, [open, requirements, initialValues]);

  const submitDisabled =
    isSubmitting ||
    flatFields.some((field) => field.required && !readOnlySet.has(field.key) && !values[field.key]?.trim());

  function updateValue(key: string, value: string) {
    setValues((current) => ({ ...current, [key]: value }));
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitDisabled) return;
    setIsSubmitting(true);
    setSubmitError(null);
    try {
      await onSubmit(values);
      onOpenChange(false);
    } catch (error) {
      // Keep the dialog open so the user can correct or retry with the same
      // values, and say why it did not close.
      setSubmitError(error instanceof Error ? error.message : "Something went wrong. Try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{title ?? `Activate ${manifest.name}`}</DialogTitle>
          <DialogDescription>
            {description ??
              (title
                ? "Update the configuration for this agent."
                : "Provide the required configuration before activating this agent template.")}
          </DialogDescription>
        </DialogHeader>

        {preface}

        <form className="grid gap-4" onSubmit={handleSubmit}>
          {requirements.map((field) =>
            field.type === "group" ? (
              <fieldset key={field.label} className="grid gap-3 rounded-xl border border-border p-4">
                <legend className="px-1 text-xs font-semibold text-muted-foreground">
                  {field.label}
                </legend>
                {field.fields.map((leaf) => (
                  <LeafFieldControl
                    key={leaf.key}
                    field={leaf}
                    label={resolveLabelTokens(leaf.label, values, fieldsByKey)}
                    value={values[leaf.key] ?? ""}
                    readOnly={readOnlySet.has(leaf.key)}
                    onChange={(value) => updateValue(leaf.key, value)}
                  />
                ))}
              </fieldset>
            ) : (
              <LeafFieldControl
                key={field.key}
                field={field}
                label={resolveLabelTokens(field.label, values, fieldsByKey)}
                value={values[field.key] ?? ""}
                readOnly={readOnlySet.has(field.key)}
                onChange={(value) => updateValue(field.key, value)}
              />
            ),
          )}

          {submitError ? (
            <p role="alert" className="m-0 text-sm font-medium text-destructive">
              {submitError}
            </p>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="outline" disabled={isSubmitting} onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitDisabled}>
              {isSubmitting ? `${submitLabel ?? "Activate"}…` : (submitLabel ?? "Activate")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function LeafFieldControl({
  field,
  label,
  value,
  readOnly,
  onChange,
}: {
  field: LeafRequirementField;
  label: string;
  value: string;
  readOnly?: boolean;
  onChange: (value: string) => void;
}) {
  const inputId = React.useId();

  return (
    <div className="grid gap-2">
      <Label htmlFor={inputId}>{label}</Label>
      {field.type === "textarea" ? (
        <Textarea
          id={inputId}
          value={value}
          placeholder={field.placeholder}
          required={field.required && !readOnly}
          aria-required={(field.required && !readOnly) || undefined}
          readOnly={readOnly}
          onChange={(event) => onChange(event.target.value)}
        />
      ) : field.type === "select" ? (
        <NativeSelect
          id={inputId}
          value={value}
          required={field.required && !readOnly}
          aria-required={(field.required && !readOnly) || undefined}
          disabled={readOnly}
          onChange={(event) => onChange(event.target.value)}
          className="w-full"
        >
          {field.options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </NativeSelect>
      ) : (
        <Input
          id={inputId}
          type={field.type}
          value={value}
          placeholder={field.placeholder}
          required={field.required && !readOnly}
          aria-required={(field.required && !readOnly) || undefined}
          readOnly={readOnly}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
    </div>
  );
}

function buildInitialValues(requirements: RequirementField[], overrides?: Record<string, string>) {
  const base = Object.fromEntries(
    flattenRequirementFields(requirements).map((field) => [field.key, field.defaultValue ?? ""]),
  );
  if (!overrides) return base;
  return { ...base, ...overrides };
}
