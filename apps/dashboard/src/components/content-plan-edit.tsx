"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { extractConvexErrorMessage } from "@/src/lib/convex-error";

// Edit controls of one proposal of a draft Content Plan (ADR-086): title, brief, date inside the period and not in
// the past, another Recipe of the same Mission type, fewer Publish targets, or removal. The server revalidates
// every edit; its refusal is shown as is.

export type EditableContent = {
  _id: string;
  title: string;
  brief: string;
  plannedAt: string;
  recipe: { id: string; name: string } | null;
  publishTargets: Array<{ target: string }>;
};

type Changes = { title?: string; brief?: string; plannedAt?: string; recipeId?: Id<"productionRecipes">; publishTargets?: string[] };

const messageOf = (caught: unknown) => extractConvexErrorMessage(caught, "The change was refused.");

export function ContentEditor({ content, period }: { content: EditableContent; period: { periodStart: string; periodEnd: string } }) {
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const update = useMutation(api.content_plan_edit.update);
  const remove = useMutation(api.content_plan_edit.remove);
  const contentId = content._id as Id<"plannedContents">;

  const attempt = async (action: () => Promise<unknown>) => {
    setError(null);
    try {
      await action();
      return true;
    } catch (caught) {
      setError(messageOf(caught));
      return false;
    }
  };
  const alert = error ? <p role="alert" className="m-0 text-sm text-destructive">{error}</p> : null;

  if (!editing) {
    return (
      <div className="grid gap-2">
        <div className="flex gap-2">
          <Button type="button" size="sm" variant="outline" onClick={() => setEditing(true)}>Edit</Button>
          <Button type="button" size="sm" variant="outline" onClick={() => void attempt(() => remove({ contentId }))}>Remove</Button>
        </div>
        {alert}
      </div>
    );
  }
  return (
    <EditForm
      content={content}
      period={period}
      alert={alert}
      onCancel={() => { setError(null); setEditing(false); }}
      onSave={async (changes) => {
        if (Object.keys(changes).length === 0 || (await attempt(() => update({ contentId, ...changes })))) setEditing(false);
      }}
    />
  );
}

function EditForm({ content, period, alert, onCancel, onSave }: {
  content: EditableContent;
  period: { periodStart: string; periodEnd: string };
  alert: React.ReactNode;
  onCancel: () => void;
  onSave: (changes: Changes) => Promise<void>;
}) {
  const contentId = content._id as Id<"plannedContents">;
  const recipes = useQuery(api.content_plan_edit.recipeOptions, { contentId }) as Array<{ id: string; name: string }> | undefined;
  const [title, setTitle] = useState(content.title);
  const [brief, setBrief] = useState(content.brief);
  const [plannedAt, setPlannedAt] = useState(content.plannedAt);
  const [recipeId, setRecipeId] = useState(content.recipe?.id ?? "");
  const [kept, setKept] = useState(() => content.publishTargets.map((entry) => entry.target));
  const today = new Date().toISOString().slice(0, 10);

  const save = () => {
    const changes: Changes = {};
    if (title !== content.title) changes.title = title;
    if (brief !== content.brief) changes.brief = brief;
    if (plannedAt !== content.plannedAt) changes.plannedAt = plannedAt;
    if (recipeId !== (content.recipe?.id ?? "")) changes.recipeId = recipeId as Id<"productionRecipes">;
    if (kept.length !== content.publishTargets.length) changes.publishTargets = kept;
    void onSave(changes);
  };

  return (
    <form noValidate className="grid gap-3" onSubmit={(event) => { event.preventDefault(); save(); }}>
      <Input aria-label="Title" value={title} onChange={(event) => setTitle(event.target.value)} />
      <Textarea aria-label="Brief" value={brief} onChange={(event) => setBrief(event.target.value)} />
      <Input
        aria-label="Date" type="date" value={plannedAt} min={today > period.periodStart ? today : period.periodStart} max={period.periodEnd}
        onChange={(event) => setPlannedAt(event.target.value)}
      />
      <NativeSelect aria-label="Recipe" value={recipeId} onChange={(event) => setRecipeId(event.target.value)}>
        {content.recipe && !(recipes ?? []).some((recipe) => recipe.id === content.recipe!.id) ? <option value={content.recipe.id}>{content.recipe.name}</option> : null}
        {(recipes ?? []).map((recipe) => <option key={recipe.id} value={recipe.id}>{recipe.name}</option>)}
      </NativeSelect>
      <fieldset className="m-0 flex flex-wrap gap-3 border-0 p-0">
        <legend className="text-sm text-muted-foreground">Publish targets (uncheck to remove)</legend>
        {content.publishTargets.map(({ target }) => (
          <label key={target} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox" checked={kept.includes(target)}
              onChange={(event) => setKept((current) => (event.target.checked ? content.publishTargets.map((entry) => entry.target).filter((name) => name === target || current.includes(name)) : current.filter((name) => name !== target)))}
            />
            {target}
          </label>
        ))}
      </fieldset>
      {alert}
      <div className="flex gap-2">
        <Button type="submit" size="sm">Save</Button>
        <Button type="button" size="sm" variant="outline" onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  );
}
