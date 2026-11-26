"use client";

import { use, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { ArrowLeft, Play, Check, Copy, FileText, History, Layers, Pencil, ShieldCheck, Trash2, type LucideIcon } from "lucide-react";
import { PageHeader } from "@/components/opengroow/page-header";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { ProductionRecipeFormDialog } from "@/src/components/production-recipe-form-dialog";
import { extractConvexErrorMessage } from "@/src/lib/convex-error";
import { recipeTargetLabel, type RecipeTarget, type RecipeVersionContent } from "@/src/lib/production-recipe-form";

// One Production Recipe (issue #143, ADR-088): its content, version history, edit
// (saves a new version), delete, and the Mission type it is written for.

type Version = RecipeVersionContent & { version: number; createdAt: number };
type RecipeDetail = { _id: string; templateId: string; missionType: string; name: string; description: string; status: "active" | "archived"; latest: Version | null };

type Props = { params: Promise<{ projectId: string; recipeId: string }> };

export function ProductionRecipePage({ params }: Props) {
  const { projectId, recipeId } = use(params);
  return <ProductionRecipeContent instanceId={decodeURIComponent(projectId)} recipeId={decodeURIComponent(recipeId)} />;
}

export function ProductionRecipeContent({ instanceId, recipeId }: { instanceId: string; recipeId: string }) {
  const id = recipeId as Id<"productionRecipes">;
  const recipe = useQuery(api.production_recipes.get, { instanceId, recipeId: id }) as RecipeDetail | null | undefined;
  const versions = useQuery(api.production_recipes.listVersions, { instanceId, recipeId: id }) as Version[] | undefined;
  const targets = useQuery(api.production_recipes.listTargets, { instanceId }) as RecipeTarget[] | undefined;
  const saveVersion = useMutation(api.production_recipes.saveVersion);
  const setTarget = useMutation(api.production_recipes.setTarget);
  const removeRecipe = useMutation(api.production_recipes.remove);
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (recipe === undefined) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (recipe === null) {
    return (
      <div className="grid gap-4">
        <p className="text-sm text-muted-foreground">Production Recipe not found.</p>
      </div>
    );
  }
  const archived = recipe.status === "archived";
  const shown = (selected !== null ? versions?.find((v) => v.version === selected) : undefined) ?? recipe.latest;
  // The recipe's own type stays listed even when no installed Template offers it any more.
  const offered = targets ?? [];
  const options = offered.some((t) => t.templateId === recipe.templateId && t.missionType === recipe.missionType)
    ? offered
    : [...offered, { templateId: recipe.templateId, templateName: recipe.templateId, missionType: recipe.missionType, label: recipe.missionType }];
  const viewingOld = shown !== null && recipe.latest !== null && shown.version !== recipe.latest.version;

  async function handleDelete() {
    if (!window.confirm("Permanently delete this Production Recipe and its versions? Missions already created with it are not affected.")) return;
    setError(null);
    try {
      await removeRecipe({ instanceId, recipeId: id });
      router.replace(`/projects/${encodeURIComponent(instanceId)}/recipes`);
    } catch (e) {
      setError(extractConvexErrorMessage(e, "Could not delete the recipe."));
    }
  }

  return (
    <div className="grid gap-8">
      <div className="grid gap-4">
        <Link
          href={`/projects/${encodeURIComponent(instanceId)}/recipes`}
          className="flex w-fit items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          Recipes
        </Link>
        <PageHeader
          title={recipe.name}
          description={recipe.description}
          action={
            <div className="flex items-center gap-3">
              {!archived && recipe.latest ? (
                <Button type="button" variant="outline" onClick={() => setEditing(true)}>
                  <Pencil className="size-4" />
                  Edit
                </Button>
              ) : null}
              <Button type="button" variant="outline" onClick={handleDelete}>
                <Trash2 className="size-4" />
                Delete
              </Button>
            </div>
          }
        />
        {error ? <p role="alert" className="m-0 text-sm text-destructive">{error}</p> : null}
      </div>

      <ContentCard icon={Play} title="Mission type">
        <NativeSelect
          aria-label="Mission type"
          disabled={archived}
          value={String(options.findIndex((t) => t.templateId === recipe.templateId && t.missionType === recipe.missionType))}
          onChange={async (e) => {
            const target = options[Number(e.target.value)];
            if (!target) return;
            setError(null);
            try {
              await setTarget({ instanceId, recipeId: id, templateId: target.templateId, missionType: target.missionType });
            } catch (err) {
              setError(extractConvexErrorMessage(err, "Could not change the Mission type."));
            }
          }}
        >
          {options.map((t, i) => (
            <option key={`${t.templateId}:${t.missionType}`} value={String(i)}>
              {recipeTargetLabel(t)}
            </option>
          ))}
        </NativeSelect>
      </ContentCard>

      {shown ? (
        <section aria-label="Recipe content" className="grid gap-6">
          {viewingOld ? (
            <p role="note" className="m-0 text-sm text-muted-foreground">
              Viewing version {shown.version}, not the latest.{" "}
              <Button type="button" variant="link" className="h-auto p-0" onClick={() => setSelected(null)}>
                Back to latest
              </Button>
            </p>
          ) : null}
          <VersionContent version={shown} />
        </section>
      ) : null}

      <section aria-label="Version history">
        <Card className="grid gap-4 px-5 py-4">
          <SectionTitle icon={History} title="Version history" />
          <ul className="m-0 grid list-none gap-2 p-0">
            {(versions ?? []).map((v) => (
              <li key={v.version}>
                <button
                  type="button"
                  aria-label={`Version ${v.version}`}
                  aria-current={shown?.version === v.version ? "true" : undefined}
                  onClick={() => setSelected(v.version)}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-xl border border-border px-3 py-2 text-left text-sm transition-colors hover:bg-surface-raised",
                    shown?.version === v.version && "bg-surface-raised",
                  )}
                >
                  <span className="rounded-full bg-primary/15 px-2.5 py-0.5 text-xs font-semibold text-primary tabular-nums">{`v${v.version}`}</span>
                  <span className="text-muted-foreground tabular-nums">{new Date(v.createdAt).toISOString().slice(0, 10)}</span>
                </button>
              </li>
            ))}
          </ul>
        </Card>
      </section>

      <ProductionRecipeFormDialog
        mode="edit"
        open={editing}
        onOpenChange={setEditing}
        initial={recipe.latest ?? undefined}
        onSubmit={async ({ prompt, instructions, constraints }) => {
          await saveVersion({ instanceId, recipeId: id, ...(prompt ? { prompt } : {}), instructions, constraints });
          setSelected(null);
        }}
      />
    </div>
  );
}

function SectionTitle({ icon: Icon, title }: { icon: LucideIcon; title: string }) {
  return (
    <div className="flex items-center gap-3">
      <Icon aria-hidden="true" className="size-5 text-muted-foreground" />
      <h2 className="m-0 text-lg font-semibold text-foreground">{title}</h2>
    </div>
  );
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      aria-label={`Copy ${label}`}
      onClick={() => {
        void navigator.clipboard?.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? <Check /> : <Copy />}
    </Button>
  );
}

function ContentCard({ icon, title, copyText, children }: { icon: LucideIcon; title: string; copyText?: string; children: ReactNode }) {
  return (
    <Card aria-label={title} className="grid gap-3 px-5 py-4">
      <div className="flex items-center justify-between gap-3">
        <SectionTitle icon={icon} title={title} />
        {copyText !== undefined ? <CopyButton text={copyText} label={title.toLowerCase()} /> : null}
      </div>
      {children}
    </Card>
  );
}

/** Long texts (the prompt) are folded to a few lines and can be unfolded. */
function FoldedText({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const long = text.length > 480;
  return (
    <div className="grid gap-2">
      <p className={cn("m-0 whitespace-pre-wrap text-sm leading-6 text-foreground", long && !open && "line-clamp-6")}>{text}</p>
      {long ? (
        <Button type="button" variant="link" className="h-auto w-fit p-0" onClick={() => setOpen((v) => !v)}>
          {open ? "Show less" : "Show more"}
        </Button>
      ) : null}
    </div>
  );
}

function VersionContent({ version }: { version: Version }) {
  return (
    <div className="grid gap-6">
      {version.prompt ? (
        <ContentCard icon={Layers} title="Prompt" copyText={version.prompt}>
          <FoldedText text={version.prompt} />
        </ContentCard>
      ) : null}
      <ContentCard icon={FileText} title="Instructions" copyText={version.instructions}>
        <FoldedText text={version.instructions} />
      </ContentCard>
      {version.constraints.length > 0 ? (
        <ContentCard icon={ShieldCheck} title="Constraints" copyText={version.constraints.join("\n")}>
          <ul className="m-0 grid gap-2 pl-5 text-sm text-foreground marker:text-primary">
            {version.constraints.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
        </ContentCard>
      ) : null}
    </div>
  );
}
