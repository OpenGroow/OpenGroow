"use client";

import type { FormEvent } from "react";
import { useEffect, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import {
  Ban,
  FileText,
  Gift,
  Info,
  Loader2,
  MessageCircle,
  Pencil,
  Save,
  StickyNote,
  Target,
  Users,
} from "lucide-react";
import { api } from "@convex/_generated/api";
import type { InstanceRecord } from "@/src/components/instance-workspace.types";
import { findInstanceById } from "@/src/components/instance-workspace.utils";
import { useAuthenticatedInstances } from "@/src/hooks/use-authenticated-instances";
import { useResolvedProjectId } from "@/src/hooks/use-resolved-project-id";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { AGENT_TONE_CLASSES } from "@/components/opengroow/agent-presentation";
import { PageHeader } from "@/components/opengroow/page-header";
import { cn } from "@/lib/utils";

type BrandPageProps = {
  params: Promise<{ projectId: string }>;
};

const BRAND_CORE_MAX_LENGTH = 2000;

const BRAND_CORE_FIELDS = [
  {
    key: "audience",
    label: "Audience",
    hint: "Who are you creating this for? Be as specific as possible.",
    placeholder: "Independent shop owners, founders, marketing teams…",
    icon: Users,
    tone: "visual",
  },
  {
    key: "tone",
    label: "Tone of voice",
    hint: "How should the brand sound? What's the style and personality?",
    placeholder: "Warm, direct, expert, playful…",
    icon: MessageCircle,
    tone: "creative",
  },
  {
    key: "offer",
    label: "Offer",
    hint: "What do you offer? Describe your product or service.",
    placeholder: "Products, services, pricing model, guarantees…",
    icon: Gift,
    tone: "creative",
  },
  {
    key: "positioning",
    label: "Positioning",
    hint: "How do you position the brand? What makes it different?",
    placeholder: "How this brand should be understood in the market…",
    icon: Target,
    tone: "research",
  },
  {
    key: "editorialRules",
    label: "Editorial rules",
    hint: "Guidelines for the type of content and messaging.",
    placeholder: "Style rules, formatting preferences, claims policy…",
    icon: FileText,
    tone: "visual",
  },
  {
    key: "constraints",
    label: "Constraints",
    hint: "Important limitations or things to keep in mind.",
    placeholder: "Legal, operational, budget, or channel constraints…",
    icon: Info,
    tone: "neutral",
  },
  {
    key: "avoid",
    label: "Things to avoid",
    hint: "What should agents avoid doing or saying?",
    placeholder: "Forbidden topics, terms, claims, or competitor mentions…",
    icon: Ban,
    tone: "neutral",
  },
  {
    key: "notes",
    label: "Additional notes",
    hint: "Anything else agents should know?",
    placeholder: "Anything else agents should know…",
    icon: StickyNote,
    tone: "creative",
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

function BrandFieldIcon({
  icon: Icon,
  tone,
}: {
  icon: (typeof BRAND_CORE_FIELDS)[number]["icon"];
  tone: (typeof BRAND_CORE_FIELDS)[number]["tone"];
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex size-12 shrink-0 items-center justify-center rounded-xl",
        AGENT_TONE_CLASSES[tone],
      )}
    >
      <Icon className="size-6" />
    </span>
  );
}

export default function BrandPage({ params }: BrandPageProps) {
  const resolvedInstanceId = useResolvedProjectId(params);
  const [brandCoreValues, setBrandCoreValues] =
    useState<BrandCoreFormState>(EMPTY_BRAND_CORE);
  const [brandCoreDirty, setBrandCoreDirty] = useState(false);
  const [editing, setEditing] = useState(false);
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
      setEditing(false);
    } catch (error: unknown) {
      setBrandCoreStatus("error");
      setBrandCoreError(
        error instanceof Error ? error.message : "Brand Core could not be saved",
      );
    }
  }

  const savedValues = brandCoreFormState(brandCore ?? null);
  const hasChanges = !sameBrandCoreFormState(
    trimBrandCoreFormState(brandCoreValues),
    trimBrandCoreFormState(savedValues),
  );
  const isSaving = brandCoreStatus === "saving";

  // Leaves edit mode and drops whatever was typed since the last save.
  function handleCancelEdit() {
    setBrandCoreValues(savedValues);
    setBrandCoreDirty(false);
    setBrandCoreStatus("idle");
    setBrandCoreError("");
    setEditing(false);
  }

  return (
    <form
      className="grid gap-8"
      onSubmit={(event) => void handleSaveBrandCore(event)}
    >
      <PageHeader
        title="Brand"
        description="Shared brand context for the agents working in this project, so every output stays on brand."
        action={
          editing ? (
            <Button type="button" variant="outline" size="lg" disabled={isSaving} onClick={handleCancelEdit}>
              Cancel
            </Button>
          ) : (
            <Button
              type="button"
              variant="outline"
              size="lg"
              disabled={brandCore === undefined}
              onClick={() => setEditing(true)}
            >
              <Pencil aria-hidden="true" />
              Edit
            </Button>
          )
        }
      />

      <div className="grid gap-4 lg:grid-cols-2">
        {BRAND_CORE_FIELDS.map((field) => {
          const value = brandCoreValues[field.key];
          return (
            <Card className="gap-4 p-5" key={field.key}>
              <div className="flex items-center gap-4">
                <BrandFieldIcon icon={field.icon} tone={field.tone} />
                <div className="grid min-w-0 gap-0.5">
                  <Label htmlFor={`brand-core-${field.key}`} className="text-base font-semibold">
                    {field.label}
                  </Label>
                  {editing ? (
                    <p className="m-0 text-sm text-muted-foreground">{field.hint}</p>
                  ) : null}
                </div>
              </div>
              {editing ? (
                <>
                  <Textarea
                    id={`brand-core-${field.key}`}
                    name={field.key}
                    autoComplete="off"
                    placeholder={field.placeholder}
                    value={value}
                    maxLength={BRAND_CORE_MAX_LENGTH}
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
                    className="min-h-36 resize-y rounded-xl bg-card leading-7"
                    disabled={isSaving}
                  />
                  <span className="text-right text-sm text-muted-foreground tabular-nums">
                    {value.length}/{BRAND_CORE_MAX_LENGTH.toLocaleString("en-US")}
                  </span>
                </>
              ) : (
                <p
                  className={cn(
                    "m-0 line-clamp-3 text-base whitespace-pre-line",
                    value.trim() ? "text-muted-foreground" : "text-muted-foreground/60",
                  )}
                >
                  {value.trim() || "Not defined yet"}
                </p>
              )}
            </Card>
          );
        })}
      </div>

      {editing ? (
      <div className="sticky bottom-4 z-10 flex justify-end">
        <Button
          type="submit"
          variant="default"
          size="lg"
          disabled={!openclawId || brandCore === undefined || !hasChanges || isSaving}
        >
          {isSaving ? (
            <Loader2 className="animate-spin" aria-hidden="true" />
          ) : (
            <Save aria-hidden="true" />
          )}
          <span>Save changes</span>
        </Button>
      </div>
      ) : null}

      {brandCoreError ? (
        <p className="text-sm text-destructive" aria-live="polite">
          {brandCoreError}
        </p>
      ) : null}
    </form>
  );
}
