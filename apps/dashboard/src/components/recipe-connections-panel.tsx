"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { extractConvexErrorMessage } from "@/src/lib/convex-error";

// Creative Connections of one recipe (issue #145): targets and compatibility
// values come only from the installed Templates' manifests (listTargets); the
// server revalidates on save and its refusals are shown as is.

type Status = "candidate" | "active" | "disabled";
type SelectField = { key: string; label: string; options: Array<{ value: string; label: string }> };
type Target = { templateId: string; templateName: string; missionType: string; label: string; selectFields: SelectField[] };
type Connection = { _id: string; recipeId: string; templateId: string; missionType: string; compatibleWhen: Record<string, string[]>; status: Status };

const STATUS_LABEL: Record<Status, string> = { candidate: "Candidate", active: "Active", disabled: "Disabled" };
const STATUS_ACTIONS: Record<Status, Array<{ to: Status; label: string }>> = {
  candidate: [{ to: "active", label: "Activate" }, { to: "disabled", label: "Disable" }],
  active: [{ to: "candidate", label: "Back to candidate" }, { to: "disabled", label: "Disable" }],
  disabled: [{ to: "candidate", label: "Back to candidate" }, { to: "active", label: "Activate" }],
};

export function RecipeConnectionsPanel({ instanceId, recipeId, archived }: { instanceId: string; recipeId: string; archived: boolean }) {
  const id = recipeId as Id<"productionRecipes">;
  const connections = useQuery(api.production_connections.list, { instanceId, recipeId: id }) as Connection[] | undefined;
  const targets = useQuery(api.production_connections.listTargets, { instanceId }) as Target[] | undefined;
  const create = useMutation(api.production_connections.create);
  const setStatus = useMutation(api.production_connections.setStatus);
  const [targetIndex, setTargetIndex] = useState("");
  const [conditions, setConditions] = useState<Record<string, string[]>>({});
  const [error, setError] = useState<string | null>(null);

  const target = targetIndex === "" ? undefined : targets?.[Number(targetIndex)];
  const findTarget = (c: Connection) => targets?.find((t) => t.templateId === c.templateId && t.missionType === c.missionType);

  function toggle(key: string, value: string) {
    setConditions((current) => {
      const values = current[key] ?? [];
      const next = values.includes(value) ? values.filter((x) => x !== value) : [...values, value];
      const { [key]: _removed, ...rest } = current;
      return next.length > 0 ? { ...rest, [key]: next } : rest;
    });
  }

  async function run(action: () => Promise<unknown>, fallback: string) {
    setError(null);
    try {
      await action();
      return true;
    } catch (e) {
      setError(extractConvexErrorMessage(e, fallback));
      return false;
    }
  }

  async function add() {
    if (!target) return;
    const ok = await run(
      () =>
        create({
          instanceId,
          recipeId: id,
          templateId: target.templateId,
          missionType: target.missionType,
          ...(Object.keys(conditions).length > 0 ? { compatibleWhen: conditions } : {}),
        }),
      "Could not connect the recipe.",
    );
    if (ok) {
      setTargetIndex("");
      setConditions({});
    }
  }

  return (
    <section aria-label="Connections" className="grid gap-3">
      <h2 className="m-0 text-lg font-semibold text-foreground">Connections</h2>
      <ul className="m-0 grid list-none gap-2 p-0">
        {(connections ?? []).map((c) => {
          const t = findTarget(c);
          const fields = t?.selectFields ?? [];
          return (
            <li key={c._id}>
              <Card className="flex flex-wrap items-center gap-3 px-5 py-3">
                <div className="grid min-w-0 flex-1 gap-0.5 text-sm">
                  <span className="font-medium text-foreground">
                    {t ? `${t.templateName} · ${t.label}` : `${c.templateId} · ${c.missionType}`}
                  </span>
                  <span className="text-muted-foreground">
                    {Object.entries(c.compatibleWhen).length === 0
                      ? "Any payload"
                      : Object.entries(c.compatibleWhen)
                          .map(([key, values]) => {
                            const field = fields.find((f) => f.key === key);
                            const labels = values.map((value) => field?.options.find((o) => o.value === value)?.label ?? value);
                            return `${field?.label ?? key}: ${labels.join(", ")}`;
                          })
                          .join(" · ")}
                  </span>
                </div>
                <Badge variant="outline">{STATUS_LABEL[c.status]}</Badge>
                {STATUS_ACTIONS[c.status].map((a) => (
                  <Button
                    key={a.to}
                    type="button"
                    variant="outline"
                    onClick={() => run(() => setStatus({ instanceId, connectionId: c._id as Id<"productionConnections">, status: a.to }), "Could not change the status.")}
                  >
                    {a.label}
                  </Button>
                ))}
              </Card>
            </li>
          );
        })}
      </ul>

      {targets && targets.length === 0 ? (
        <p className="m-0 text-sm text-muted-foreground">No installed Template can consume a recipe yet.</p>
      ) : archived ? null : (
        <Card className="grid gap-3 px-5 py-4">
          <div className="grid gap-1.5">
            <Label htmlFor="connection-target">Connect to</Label>
            <NativeSelect
              id="connection-target"
              value={targetIndex}
              onChange={(e) => {
                setTargetIndex(e.target.value);
                setConditions({});
              }}
            >
              <option value="">Choose a Mission type</option>
              {(targets ?? []).map((t, i) => (
                <option key={`${t.templateId}:${t.missionType}`} value={String(i)}>
                  {`${t.templateName} · ${t.label}`}
                </option>
              ))}
            </NativeSelect>
          </div>
          {target?.selectFields.map((field) => (
            <div key={field.key} role="group" aria-label={field.label} className="grid gap-1.5">
              <span className="text-sm font-medium text-muted-foreground">{`${field.label} (all if none selected)`}</span>
              <div className="flex flex-wrap gap-2">
                {field.options.map((o) => {
                  const on = conditions[field.key]?.includes(o.value) ?? false;
                  return (
                    <Button key={o.value} type="button" size="sm" variant={on ? "default" : "outline"} aria-pressed={on} onClick={() => toggle(field.key, o.value)}>
                      {o.label}
                    </Button>
                  );
                })}
              </div>
            </div>
          ))}
          <Button type="button" className="w-fit" disabled={!target} onClick={add}>
            Add connection
          </Button>
        </Card>
      )}
      {error ? <p role="alert" className="m-0 text-sm text-destructive">{error}</p> : null}
    </section>
  );
}
