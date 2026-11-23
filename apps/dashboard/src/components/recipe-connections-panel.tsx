"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { ChevronDown, Link2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import {
  Combobox,
  ComboboxChip,
  ComboboxChips,
  ComboboxChipsInput,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxItem,
  ComboboxItemCheck,
  ComboboxList,
  ComboboxTrigger,
  ComboboxValue,
  useComboboxAnchor,
} from "@/components/ui/combobox";
import { extractConvexErrorMessage } from "@/src/lib/convex-error";

// Creative Connections of one recipe (issue #145): one multi-select of the
// Mission types it is offered to. Ticking a target connects the recipe, un-ticking
// removes the connection. Targets come only from the installed Templates'
// manifests (listTargets); the server revalidates and its refusals are shown as is.

type Target = { templateId: string; templateName: string; missionType: string; label: string };
type Connection = { _id: string; recipeId: string; templateId: string; missionType: string; templateName?: string; missionTypeLabel?: string };

const keyOf = (templateId: string, missionType: string) => `${templateId}\u0000${missionType}`;

export function RecipeConnectionsPanel({ instanceId, recipeId }: { instanceId: string; recipeId: string }) {
  const id = recipeId as Id<"productionRecipes">;
  const connections = useQuery(api.production_connections.list, { instanceId, recipeId: id }) as Connection[] | undefined;
  const targets = useQuery(api.production_connections.listTargets, { instanceId }) as Target[] | undefined;
  const create = useMutation(api.production_connections.create);
  const remove = useMutation(api.production_connections.remove);
  const anchor = useComboboxAnchor();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A connection whose Template no longer declares the target stays listed, so it can be removed.
  const { labels, items, connectionByKey } = useMemo(() => {
    const labels = new Map<string, string>();
    for (const t of targets ?? []) labels.set(keyOf(t.templateId, t.missionType), `${t.templateName} · ${t.label}`);
    const connectionByKey = new Map<string, Connection>();
    for (const c of connections ?? []) {
      const key = keyOf(c.templateId, c.missionType);
      connectionByKey.set(key, c);
      if (!labels.has(key)) labels.set(key, `${c.templateName ?? c.templateId} · ${c.missionTypeLabel ?? c.missionType}`);
    }
    // Connected targets are shown as chips only: the list offers what is left to connect.
    return { labels, items: [...labels.keys()].filter((key) => !connectionByKey.has(key)), connectionByKey };
  }, [targets, connections]);
  const selected = [...connectionByKey.keys()];

  async function change(next: string[]) {
    setError(null);
    try {
      for (const key of next.filter((k) => !connectionByKey.has(k))) {
        const [templateId, missionType] = key.split("\u0000") as [string, string];
        await create({ instanceId, recipeId: id, templateId, missionType });
      }
      for (const key of selected.filter((k) => !next.includes(k))) {
        await remove({ instanceId, connectionId: connectionByKey.get(key)!._id as Id<"productionConnections"> });
      }
    } catch (e) {
      setError(extractConvexErrorMessage(e, "Could not update the connections."));
    }
  }

  return (
    <section aria-label="Connections">
      <Card className="grid gap-4 px-5 py-4">
        <div className="flex items-center gap-3">
          <Link2 aria-hidden="true" className="size-5 text-muted-foreground" />
          <h2 className="m-0 text-lg font-semibold text-foreground">Connections</h2>
        </div>
        {targets && targets.length === 0 && selected.length === 0 ? (
          <p className="m-0 text-sm text-muted-foreground">No installed Template can consume a recipe yet.</p>
        ) : (
          <Combobox
            multiple
            items={items}
            value={selected}
            onValueChange={(next) => void change(next as string[])}
            open={open}
            onOpenChange={setOpen}
            itemToStringLabel={(key: string) => labels.get(key) ?? key}
          >
            <ComboboxChips ref={anchor} data-testid="connection-select">
              <ComboboxValue>
                {(values: string[]) => (
                  <>
                    {values.map((key) => (
                      <ComboboxChip key={key}>{labels.get(key) ?? key}</ComboboxChip>
                    ))}
                    <ComboboxChipsInput aria-label="Mission types" placeholder={values.length === 0 ? "Search Mission types…" : ""} />
                  </>
                )}
              </ComboboxValue>
              <ComboboxTrigger aria-label="Show Mission types" className="ml-auto flex size-7 items-center justify-center text-muted-foreground">
                <ChevronDown />
              </ComboboxTrigger>
            </ComboboxChips>
            <ComboboxContent anchor={anchor}>
              <ComboboxEmpty>No Mission type found.</ComboboxEmpty>
              <ComboboxList>
                {(key: string) => (
                  <ComboboxItem key={key} value={key}>
                    <ComboboxItemCheck />
                    {labels.get(key) ?? key}
                  </ComboboxItem>
                )}
              </ComboboxList>
            </ComboboxContent>
          </Combobox>
        )}
        {error ? <p role="alert" className="m-0 text-sm text-destructive">{error}</p> : null}
      </Card>
    </section>
  );
}
