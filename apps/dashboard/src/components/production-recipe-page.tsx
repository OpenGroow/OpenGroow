"use client";

import { use, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { ArrowLeft, Pencil } from "lucide-react";
import { PageHeader } from "@/components/opengroow/page-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { RecipeConnectionsPanel } from "@/src/components/recipe-connections-panel";
import { ProductionRecipeFormDialog } from "@/src/components/production-recipe-form-dialog";
import { extractConvexErrorMessage } from "@/src/lib/convex-error";
import type { RecipeVersionContent } from "@/src/lib/production-recipe-form";

// One Production Recipe (issue #143): its content, version history, edit
// (saves a new version) and archive. The connections panel (#145) is embedded below.

type Version = RecipeVersionContent & { version: number; createdAt: number };
type RecipeDetail = { _id: string; creativeFamilyId: string; name: string; description: string; status: "active" | "archived"; latest: Version | null };

type Props = { params: Promise<{ projectId: string; familyId: string; recipeId: string }> };

export function ProductionRecipePage({ params }: Props) {
  const { projectId, recipeId } = use(params);
  return <ProductionRecipeContent instanceId={decodeURIComponent(projectId)} recipeId={decodeURIComponent(recipeId)} />;
}

export function ProductionRecipeContent({ instanceId, recipeId }: { instanceId: string; recipeId: string }) {
  const id = recipeId as Id<"productionRecipes">;
  const recipe = useQuery(api.production_recipes.get, { instanceId, recipeId: id }) as RecipeDetail | null | undefined;
  const versions = useQuery(api.production_recipes.listVersions, { instanceId, recipeId: id }) as Version[] | undefined;
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
        {error ? <p role="alert" className="m-0 text-sm text-destructive">{error}</p> : null}
      </div>

      {shown ? (
        <section aria-label="Recipe content" className="grid gap-3">
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

      <section aria-label="Version history" className="grid gap-3">
        <h2 className="m-0 text-lg font-semibold text-foreground">Version history</h2>
        <ul className="m-0 grid list-none gap-2 p-0">
          {(versions ?? []).map((v) => (
            <li key={v.version} className="flex items-center gap-3 text-sm">
              <Button type="button" variant="link" className="h-auto p-0" aria-label={`Version ${v.version}`} onClick={() => setSelected(v.version)}>
                Version {v.version}
              </Button>
              <span className="text-muted-foreground tabular-nums">{new Date(v.createdAt).toISOString().slice(0, 10)}</span>
            </li>
          ))}
        </ul>
      </section>

      <RecipeConnectionsPanel instanceId={instanceId} recipeId={recipeId} archived={archived} />

      <ProductionRecipeFormDialog
        mode="edit"
        open={editing}
        onOpenChange={setEditing}
        initial={recipe.latest ?? undefined}
        onSubmit={async ({ prompt, instructions, constraints, variables }) => {
          await saveVersion({ instanceId, recipeId: id, ...(prompt ? { prompt } : {}), instructions, constraints, variables });
          setSelected(null);
        }}
      />
    </div>
  );
}

function VersionContent({ version }: { version: Version }) {
  return (
    <Card className="grid gap-4 px-5 py-4">
      {version.prompt ? <Field label="Prompt" text={version.prompt} /> : null}
      <Field label="Instructions" text={version.instructions} />
      {version.constraints.length > 0 ? (
        <div className="grid gap-1">
          <h3 className="m-0 text-sm font-medium text-muted-foreground">Constraints</h3>
          <ul className="m-0 grid gap-1 pl-5 text-sm text-foreground">
            {version.constraints.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {version.variables.length > 0 ? (
        <div className="grid gap-1">
          <h3 className="m-0 text-sm font-medium text-muted-foreground">Variables</h3>
          <dl className="m-0 grid gap-2 text-sm">
            {version.variables.map((variable) => (
              <div key={variable.name} className="grid gap-0.5">
                <dt className="font-medium text-foreground">{`{${variable.name}}`}</dt>
                <dd className="m-0 text-muted-foreground">
                  {variable.values.join(", ")}
                  {variable.default !== undefined ? ` (default: ${variable.default})` : ""}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      ) : null}
    </Card>
  );
}

function Field({ label, text }: { label: string; text: string }) {
  return (
    <div className="grid gap-1">
      <h3 className="m-0 text-sm font-medium text-muted-foreground">{label}</h3>
      <p className="m-0 whitespace-pre-wrap text-sm text-foreground">{text}</p>
    </div>
  );
}
