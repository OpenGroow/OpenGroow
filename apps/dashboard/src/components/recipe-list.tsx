"use client";

import * as React from "react";
import Link from "next/link";
import { useConvex, useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { BarChart3, BookOpen, Ellipsis, ExternalLink, Layers, Play, Trash2 } from "lucide-react";
import { SearchField } from "@/components/opengroow/filter-bar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLinkItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { NativeSelect } from "@/components/ui/native-select";
import { extractConvexErrorMessage } from "@/src/lib/convex-error";
import { recipeDeletionMessage, type RecipeTarget } from "@/src/lib/production-recipe-form";

// The Project's Production Recipes as a gallery, on the Recipes page (issue #143, ADR-088).

type RecipeRow = {
  _id: string;
  createdAt: number;
  templateId: string;
  missionType: string;
  name: string;
  description: string;
  latestVersion: number;
};
type RecipeStats = { recipeId: string; publications: number };
type Sort = "recent" | "name" | "posts";

/** A stable hue per recipe, so the default covers differ from one card to the next. */
const hueOf = (id: string): number => [...id].reduce((hash, char) => (hash * 31 + char.charCodeAt(0)) % 360, 7);

/** The recipe's image: recipes carry none, so each one gets a default cover (a gradient and a book). */
export function RecipeCover({ recipeId, className }: { recipeId: string; className?: string }) {
  const hue = hueOf(recipeId);
  return (
    <div
      data-testid="recipe-cover"
      aria-hidden="true"
      className={`flex items-center justify-center overflow-hidden text-white/80 ${className ?? ""}`}
      style={{ backgroundImage: `linear-gradient(145deg, hsl(${hue} 55% 38%), hsl(${(hue + 50) % 360} 60% 22%))` }}
    >
      <BookOpen className="size-10" />
    </div>
  );
}

function RecipeCard({ recipe, instanceId, target, posts, onDelete }: { recipe: RecipeRow; instanceId: string; target?: RecipeTarget; posts?: number; onDelete: () => void }) {
  const href = `/projects/${encodeURIComponent(instanceId)}/recipes/${encodeURIComponent(recipe._id)}`;
  return (
    <li className="min-w-0">
      <Card className="relative flex h-full flex-row gap-4 p-3 transition-colors hover:bg-surface-raised has-[a:focus-visible]:ring-2 has-[a:focus-visible]:ring-ring">
        <RecipeCover recipeId={recipe._id} className="aspect-[3/4] w-32 shrink-0 rounded-xl sm:w-36" />
        <div className="grid min-w-0 flex-1 content-start gap-2 py-1 pr-1">
          <div className="flex items-start gap-2">
            <Link href={href} className="min-w-0 truncate text-lg font-semibold text-foreground outline-none after:absolute after:inset-0 after:content-['']">
              {recipe.name}
            </Link>
            <span className="rounded-full bg-primary/15 px-2.5 py-0.5 text-xs font-semibold text-primary tabular-nums">{`v${recipe.latestVersion}`}</span>
            <div className="relative z-10 ml-auto">
              <DropdownMenu>
                <DropdownMenuTrigger render={<Button variant="ghost" size="icon" className="size-8" aria-label={`Actions for ${recipe.name}`} />}>
                  <Ellipsis />
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  <DropdownMenuLinkItem render={<Link href={href} />}>
                    <ExternalLink />
                    Open
                  </DropdownMenuLinkItem>
                  <DropdownMenuItem onClick={onDelete}>
                    <Trash2 />
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
          <p className="m-0 line-clamp-2 text-sm text-muted-foreground">{recipe.description}</p>
          <div className="flex flex-wrap items-center gap-2">
            <span className="flex items-center gap-1.5 rounded-lg bg-muted px-2.5 py-1 text-xs font-medium text-foreground">
              <Play aria-hidden="true" className="size-3.5" />
              {target?.templateName ?? recipe.templateId}
            </span>
            <span className="flex items-center gap-1.5 rounded-lg bg-muted px-2.5 py-1 text-xs font-medium text-foreground">
              <Layers aria-hidden="true" className="size-3.5" />
              {target?.label ?? recipe.missionType}
            </span>
          </div>
          {posts !== undefined ? (
            <p className="m-0 flex items-center gap-1.5 text-sm text-muted-foreground tabular-nums">
              <BarChart3 aria-hidden="true" className="size-4" />
              {`${posts} ${posts === 1 ? "post" : "posts"}`}
            </p>
          ) : null}
        </div>
      </Card>
    </li>
  );
}

export function RecipeList({ instanceId }: { instanceId: string }) {
  const recipes = useQuery(api.production_recipes.list, { instanceId }) as RecipeRow[] | undefined;
  const targets = useQuery(api.production_recipes.listTargets, { instanceId }) as RecipeTarget[] | undefined;
  // Published posts per recipe over the last year, from the Analytics read; absent until it arrives.
  const summary = useQuery(api.analytics_summary.summaryForProject, { instanceId, days: 365, groupBy: "recipe" }) as { recipes?: RecipeStats[] } | null | undefined;
  const removeRecipe = useMutation(api.production_recipes.remove);
  const convex = useConvex();
  const [search, setSearch] = React.useState("");
  const [type, setType] = React.useState("all");
  const [sort, setSort] = React.useState<Sort>("recent");
  const [error, setError] = React.useState<string | null>(null);

  const targetByKey = React.useMemo(() => new Map((targets ?? []).map((t) => [`${t.templateId}::${t.missionType}`, t])), [targets]);
  const postsById = React.useMemo(() => new Map((summary?.recipes ?? []).map((r) => [r.recipeId, r.publications])), [summary]);
  const typeKey = (recipe: RecipeRow) => `${recipe.templateId}::${recipe.missionType}`;
  const targetOf = (recipe: RecipeRow) => targetByKey.get(typeKey(recipe));
  const postsOf = (recipe: RecipeRow): number | undefined => (summary === undefined ? undefined : (postsById.get(recipe._id) ?? 0));
  const types = [...new Map((recipes ?? []).map((recipe) => [typeKey(recipe), targetOf(recipe)?.label ?? recipe.missionType])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
  const needle = search.trim().toLowerCase();
  const visible = (recipes ?? [])
    .filter((recipe) => (type === "all" || typeKey(recipe) === type) && (needle === "" || `${recipe.name} ${recipe.description}`.toLowerCase().includes(needle)))
    .sort((a, b) => (sort === "name" ? a.name.localeCompare(b.name) : sort === "posts" ? (postsOf(b) ?? 0) - (postsOf(a) ?? 0) : b.createdAt - a.createdAt));

  async function handleDelete(recipe: RecipeRow) {
    setError(null);
    try {
      const impact = await convex.query(api.production_recipes.deletionImpact, { instanceId, recipeId: recipe._id as Id<"productionRecipes"> });
      if (!window.confirm(recipeDeletionMessage(impact?.plannedContents ?? 0))) return;
      await removeRecipe({ instanceId, recipeId: recipe._id as Id<"productionRecipes"> });
    } catch (e) {
      setError(extractConvexErrorMessage(e, "Could not delete the recipe."));
    }
  }

  return (
    <section aria-label="Production Recipes" className="grid grid-cols-[minmax(0,1fr)] gap-5">
      <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-center">
        <h2 className="m-0 flex items-center gap-3 text-2xl font-bold text-foreground">
          Production Recipes
          {recipes ? <span className="rounded-full bg-muted px-3 py-0.5 text-sm font-semibold tabular-nums text-muted-foreground">{recipes.length}</span> : null}
        </h2>
        <div className="flex flex-col gap-3 sm:flex-row">
          <SearchField value={search} onChange={setSearch} label="Search recipes" placeholder="Search recipes…" className="lg:w-56" />
          <NativeSelect aria-label="Filter by type" className="h-11 sm:w-44" value={type} onChange={(event) => setType(event.target.value)}>
            <option value="all">All types</option>
            {types.map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </NativeSelect>
          <NativeSelect aria-label="Sort recipes" className="h-11 sm:w-40" value={sort} onChange={(event) => setSort(event.target.value === "name" ? "name" : event.target.value === "posts" ? "posts" : "recent")}>
            <option value="recent">Recent</option>
            <option value="name">Name</option>
            <option value="posts">Most posts</option>
          </NativeSelect>
        </div>
      </div>
      {error ? <p role="alert" className="m-0 text-sm text-destructive">{error}</p> : null}
      {recipes === undefined ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : recipes.length === 0 ? (
        <p className="text-sm text-muted-foreground">No recipes yet. Create one, or generate one from an idea.</p>
      ) : visible.length === 0 ? (
        <p className="text-sm text-muted-foreground">No recipe matches these filters.</p>
      ) : (
        <ul className="m-0 grid list-none gap-4 p-0 lg:grid-cols-2 2xl:grid-cols-3">
          {visible.map((recipe) => (
            <RecipeCard key={recipe._id} recipe={recipe} instanceId={instanceId} target={targetOf(recipe)} posts={postsOf(recipe)} onDelete={() => void handleDelete(recipe)} />
          ))}
        </ul>
      )}
    </section>
  );
}
