"use client";

import * as React from "react";
import { use, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { ArrowLeft, Play, Check, Copy, FileText, History, Layers, Pencil, ShieldCheck, type LucideIcon } from "lucide-react";
import { PageHeader } from "@/components/opengroow/page-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { ProductionRecipeFormDialog } from "@/src/components/production-recipe-form-dialog";
import { extractConvexErrorMessage } from "@/src/lib/convex-error";
import type { RecipeVersionContent } from "@/src/lib/production-recipe-form";

// One Production Recipe (issue #143): its content, version history, edit
// (saves a new version) and archive. The connections panel (#145) is embedded below.

type Version = RecipeVersionContent & { version: number; createdAt: number };
type RecipeDetail = { _id: string; creativeFamilyId: string; templateId: string; missionType: string; name: string; description: string; status: "active" | "archived"; latest: Version | null };

type Props = { params: Promise<{ projectId: string; familyId: string; recipeId: string }> };

export function ProductionRecipePage({ params }: Props) {
  const { projectId, recipeId } = use(params);
  return <ProductionRecipeContent instanceId={decodeURIComponent(projectId)} recipeId={decodeURIComponent(recipeId)} />;
}

export function ProductionRecipeContent({ instanceId, recipeId }: { instanceId: string; recipeId: string }) {
  const id = recipeId as Id<"productionRecipes">;
  const recipe = useQuery(api.production_recipes.get, { instanceId, recipeId: id }) as RecipeDetail | null | undefined;
  const versions = useQuery(api.production_recipes.listVersions, { instanceId, recipeId: id }) as Version[] | undefined;
  const targets = useQuery(api.production_recipes.listTargets, { instanceId }) as Array<{ templateId: string; templateName: string; missionType: string; label: string }> | undefined;
  const saveVersion = useMutation(api.production_recipes.saveVersion);
  const archive = useMutation(api.production_recipes.archive);
  const unarchive = useMutation(api.production_recipes.unarchive);
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
  const viewingOld = shown !== null && recipe.latest !== null && shown.version !== recipe.latest.version;

  async function toggleArchive() {
    setError(null);
    try {
      await (archived ? unarchive : archive)({ instanceId, recipeId: id });
    } catch (e) {
      setError(extractConvexErrorMessage(e, "Could not update the recipe."));
    }
  }

  return (
    <div className="grid gap-8">
      <div className="grid gap-4">
        <Link
          href={`/projects/${encodeURIComponent(instanceId)}/library/${encodeURIComponent(recipe.creativeFamilyId)}`}
          className="flex w-fit items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          Creative Family
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
              <Button type="button" variant="outline" onClick={toggleArchive}>
                {archived ? "Unarchive" : "Archive"}
              </Button>
            </div>
          }
        />
        <p className="m-0 flex items-center gap-2 text-sm text-muted-foreground" aria-label="Mission type">
          <Play aria-hidden="true" className="size-4" />
          {(() => {
            const t = targets?.find((x) => x.templateId === recipe.templateId && x.missionType === recipe.missionType);
            return t ? `${t.templateName} · ${t.label}` : recipe.missionType;
          })()}
        </p>
        {error ? <p role="alert" className="m-0 text-sm text-destructive">{error}</p> : null}
      </div>

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

      <div className="grid items-start gap-6">
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
      </div>

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

function ContentCard({ icon, title, copyText, children }: { icon: LucideIcon; title: string; copyText?: string; children: React.ReactNode }) {
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
