"use client";

import type { FormEvent } from "react";
import { useEffect, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { Loader2, Save } from "lucide-react";
import { api } from "@convex/_generated/api";
import type { InstanceRecord } from "@/src/components/instance-workspace.types";
import { findInstanceById } from "@/src/components/instance-workspace.utils";
import { useAuthenticatedInstances } from "@/src/hooks/use-authenticated-instances";
import { useResolvedProjectId } from "@/src/hooks/use-resolved-project-id";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

type BrandPageProps = {
  params: Promise<{ projectId: string }>;
};

const BRAND_CORE_FIELDS = [
  {
    key: "audience",
    label: "Audience",
    placeholder: "Independent shop owners, founders, marketing teams…",
  },
  {
    key: "tone",
    label: "Tone of voice",
    placeholder: "Warm, direct, expert, playful…",
  },
  {
    key: "offer",
    label: "Offer",
    placeholder: "Products, services, pricing model, guarantees…",
  },
  {
    key: "positioning",
    label: "Positioning",
    placeholder: "How this brand should be understood in the market…",
  },
  {
    key: "editorialRules",
    label: "Editorial rules",
    placeholder: "Style rules, formatting preferences, claims policy…",
  },
  {
    key: "constraints",
    label: "Constraints",
    placeholder: "Legal, operational, budget, or channel constraints…",
  },
  {
    key: "avoid",
    label: "Things to avoid",
    placeholder: "Forbidden topics, terms, claims, or competitor mentions…",
  },
  {
    key: "notes",
    label: "Additional notes",
    placeholder: "Anything else agents should know…",
  },
] as const;

type BrandCoreFieldKey = (typeof BRAND_CORE_FIELDS)[number]["key"];
type BrandCoreFormState = Record<BrandCoreFieldKey, string>;

const EMPTY_BRAND_CORE: BrandCoreFormState = {
  audience: "",
  tone: "",
  offer: "",
  positioning: "",
  editorialRules: "",
  constraints: "",
  avoid: "",
  notes: "",
};

function brandCoreFormState(
  brandCore: Partial<BrandCoreFormState> | null,
): BrandCoreFormState {
  return {
    audience: brandCore?.audience ?? "",
    tone: brandCore?.tone ?? "",
    offer: brandCore?.offer ?? "",
    positioning: brandCore?.positioning ?? "",
    editorialRules: brandCore?.editorialRules ?? "",
    constraints: brandCore?.constraints ?? "",
    avoid: brandCore?.avoid ?? "",
    notes: brandCore?.notes ?? "",
  };
}

function trimBrandCoreFormState(values: BrandCoreFormState): BrandCoreFormState {
  return {
    audience: values.audience.trim(),
    tone: values.tone.trim(),
    offer: values.offer.trim(),
    positioning: values.positioning.trim(),
    editorialRules: values.editorialRules.trim(),
    constraints: values.constraints.trim(),
    avoid: values.avoid.trim(),
    notes: values.notes.trim(),
  };
}

function sameBrandCoreFormState(a: BrandCoreFormState, b: BrandCoreFormState): boolean {
  return BRAND_CORE_FIELDS.every((field) => a[field.key] === b[field.key]);
}

export default function BrandPage({ params }: BrandPageProps) {
  const resolvedInstanceId = useResolvedProjectId(params);
  const [brandCoreValues, setBrandCoreValues] =
    useState<BrandCoreFormState>(EMPTY_BRAND_CORE);
  const [brandCoreDirty, setBrandCoreDirty] = useState(false);
  const [brandCoreStatus, setBrandCoreStatus] = useState<"idle" | "saving" | "saved" | "error">(
    "idle",
  );
  const [brandCoreError, setBrandCoreError] = useState("");

  const instances = useAuthenticatedInstances<InstanceRecord>();
  const upsertBrandCore = useMutation(api.brand_cores.upsert);

  const instance = findInstanceById(instances, resolvedInstanceId);

  const openclawId = instance?.openclawId;
  const brandCore = useQuery(
    api.brand_cores.get,
    openclawId ? { instanceId: openclawId } : "skip",
  );

  useEffect(() => {
    setBrandCoreDirty(false);
    setBrandCoreStatus("idle");
    setBrandCoreError("");
  }, [openclawId]);

  useEffect(() => {
    if (brandCore === undefined || brandCoreDirty) {
      return;
    }
    const nextValues = brandCoreFormState(brandCore);
    setBrandCoreValues((current) =>
      sameBrandCoreFormState(current, nextValues) ? current : nextValues,
    );
  }, [brandCoreDirty, brandCore]);

  if (!instance || !resolvedInstanceId) {
    return null;
  }

  async function handleSaveBrandCore(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!openclawId || brandCoreStatus === "saving") {
      return;
    }

    setBrandCoreStatus("saving");
    setBrandCoreError("");

    try {
      const trimmedValues = trimBrandCoreFormState(brandCoreValues);
      await upsertBrandCore({
        instanceId: openclawId,
        ...trimmedValues,
      });
      setBrandCoreValues(trimmedValues);
      setBrandCoreDirty(false);
      setBrandCoreStatus("saved");
    } catch (error: unknown) {
      setBrandCoreStatus("error");
      setBrandCoreError(
        error instanceof Error ? error.message : "Brand Core could not be saved",
      );
    }
  }

  return (
    <section className="grid gap-8">
      <Card className="gap-5 rounded-[1.5rem] border-0 bg-white/92 py-6 shadow-[0_18px_48px_rgba(25,28,28,0.08)] ring-1 ring-[rgba(0,38,27,0.08)]">
        <CardHeader className="grid gap-2 px-6 pb-0">
          <CardTitle className="text-[1.35rem] leading-[1.1] tracking-[-0.04em] text-[var(--dashboard-ink)]">
            Brand Core
          </CardTitle>
          <CardDescription className="max-w-2xl text-base leading-7 text-[var(--dashboard-ink-muted)]">
            Shared brand context for agents working in this project.
          </CardDescription>
        </CardHeader>
        <CardContent className="px-6">
          <form className="grid gap-4" onSubmit={(event) => void handleSaveBrandCore(event)}>
            <div className="grid gap-4 lg:grid-cols-2">
              {BRAND_CORE_FIELDS.map((field) => (
                <div className="grid gap-2" key={field.key}>
                  <Label htmlFor={`brand-core-${field.key}`}>{field.label}</Label>
                  <Textarea
                    id={`brand-core-${field.key}`}
                    name={field.key}
                    autoComplete="off"
                    placeholder={field.placeholder}
                    value={brandCoreValues[field.key]}
                    onChange={(event) => {
                      setBrandCoreValues((current) => ({
                        ...current,
                        [field.key]: event.target.value,
                      }));
                      setBrandCoreDirty(true);
                      setBrandCoreStatus("idle");
                      setBrandCoreError("");
                    }}
                    onKeyDown={(event) => {
                      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                        event.currentTarget.form?.requestSubmit();
                      }
                    }}
                    className="min-h-28 resize-y rounded-xl bg-white text-base leading-7 md:text-base"
                    disabled={brandCore === undefined || brandCoreStatus === "saving"}
                  />
                </div>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <Button
                type="submit"
                disabled={!openclawId || brandCore === undefined || brandCoreStatus === "saving"}
                className="h-11 gap-2 rounded-xl bg-[rgba(220,230,224,0.66)] px-5 text-[var(--dashboard-primary)] hover:bg-[rgba(220,230,224,0.82)]"
              >
                {brandCoreStatus === "saving" ? (
                  <Loader2 className="animate-spin" aria-hidden="true" />
                ) : (
                  <Save aria-hidden="true" />
                )}
                <span>Save</span>
              </Button>
              <span
                className="text-sm text-[var(--dashboard-ink-muted)]"
                aria-live="polite"
              >
                {brandCore === undefined
                  ? "Loading Brand Core…"
                  : brandCoreStatus === "saved"
                    ? "Saved"
                    : "Optional. Leave empty if this is not defined yet."}
              </span>
            </div>

            {brandCoreError ? (
              <p className="text-sm text-[var(--dashboard-tertiary)]" aria-live="polite">
                {brandCoreError}
              </p>
            ) : null}
          </form>
        </CardContent>
      </Card>
    </section>
  );
}
