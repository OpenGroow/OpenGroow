"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { Play } from "lucide-react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { RecipeOptions } from "./production-recipe-select";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { extractConvexErrorMessage } from "@/src/lib/convex-error";

/** Fixes a Schedule whose recipe is unavailable: picks a compatible recipe, which clears the reason but never resumes it. */
export function ScheduleRecipePicker({ instanceId, schedule }: { instanceId: string; schedule: { _id: Id<"schedules">; templateId: string; type: string } }) {
  const offered = useQuery(api.production_recipes.listForMissionType, { instanceId, templateId: schedule.templateId, missionType: schedule.type });
  const setRecipe = useMutation(api.schedules.setRecipe);
  const [error, setError] = useState<string | null>(null);
  return (
    <label className="inline-flex items-center gap-2 text-xs text-muted-foreground">
      Choose a recipe
      <NativeSelect
        data-testid="schedule-recipe-picker"
        value=""
        onChange={(e) => {
          setError(null);
          setRecipe({ scheduleId: schedule._id, recipeId: e.target.value as Id<"productionRecipes"> }).catch((err: unknown) =>
            setError(extractConvexErrorMessage(err, "Failed to set the recipe.")),
          );
        }}
      >
        <option value="" disabled>
          Select...
        </option>
        <RecipeOptions recipes={offered ?? []} />
      </NativeSelect>
      {error ? <span role="alert" className="text-destructive">{error}</span> : null}
    </label>
  );
}

/** Creates a Mission from the Schedule now: shows it is running and says why when it is refused. */
export function RunNowButton({ run, blockedReason }: { run: () => Promise<unknown>; blockedReason?: string }) {
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setRunning(true);
    setError(null);
    try {
      await run();
    } catch (err) {
      setError(extractConvexErrorMessage(err, "Failed to run the Schedule now."));
    } finally {
      setRunning(false);
    }
  }

  return (
    <>
      <Button
        variant="outline"
        className="rounded-full"
        data-action="run-now"
        loading={running}
        disabled={blockedReason !== undefined}
        title={blockedReason}
        onClick={() => { void handleClick(); }}
      >
        <Play />
        Run now
      </Button>
      {blockedReason ? <span className="sr-only" data-testid="run-now-blocked">{blockedReason}</span> : null}
      {error ?<span role="alert" className="text-xs text-destructive" data-testid="run-now-error">{error}</span> : null}
    </>
  );
}
