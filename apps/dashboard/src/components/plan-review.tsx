"use client";

import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { titleCase } from "@/src/lib/mission-type";

/**
 * The Plan a Strategy Agent proposes (ADR-081), read from the review projection.
 * Each item is a Mission the Agent suggests, with the reason and the figures behind it.
 * Nothing is created from the Plan here.
 */

export type PlanItemView = {
  type: string;
  /** The id of the done, measured Mission the item starts from. */
  basedOn: string;
  /** Its number, when the review could resolve it. */
  basedOnNumber?: number;
  payload: unknown;
  reason: string;
  figures: Array<{ label: string; value: string | number }>;
};

/** The figures behind a Plan item, as label / value lines. */
export function PlanFigures({ figures, testId, className }: { figures: PlanItemView["figures"]; testId?: string; className?: string }) {
  return (
    <dl className={cn("m-0 grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-sm", className)} data-testid={testId}>
      {figures.map((figure, at) => (
        <div key={at} className="contents">
          <dt className="text-muted-foreground">{figure.label}</dt>
          <dd className="m-0 text-foreground">{String(figure.value)}</dd>
        </div>
      ))}
    </dl>
  );
}

export function PlanReview({
  instanceId,
  emptyReason,
  items,
  selected,
  onToggle,
  typeLabel = titleCase,
}: {
  items: PlanItemView[];
  /** The Project, for the link to the Mission an item is based on. */
  instanceId: string;
  /** Why the Agent proposes nothing: its summary, shown when the Plan is empty. */
  emptyReason?: string;
  /** The user-facing name of a Mission type; defaults to the type as a title. */
  typeLabel?: (type: string) => string;
  /** When given, each item has a checkbox: the Missions of the checked items are created on approval. */
  selected?: boolean[];
  onToggle?: (index: number) => void;
}) {
  return (
    <Card className="grid gap-4 p-6" data-testid="plan-review">
      <h2 className="m-0 text-lg font-semibold text-foreground">Proposed Missions</h2>
      {items.length === 0 ? (
        <div className="grid gap-1 text-sm" data-testid="plan-empty">
          <p className="m-0 text-muted-foreground">The Agent has nothing to propose.</p>
          {emptyReason && <p className="m-0 text-foreground">{emptyReason}</p>}
        </div>
      ) : (
        <ol className="m-0 grid list-none gap-4 p-0">
          {items.map((item, index) => (
            <li
              key={index}
              data-testid="plan-item"
              className="grid gap-3 rounded-xl border border-border bg-background p-4"
            >
              <div className="flex flex-wrap items-center gap-2">
                {selected && (
                  <Checkbox
                    checked={selected[index] ?? true}
                    onCheckedChange={() => onToggle?.(index)}
                    aria-label={`Create the Mission of item ${index + 1}`}
                    data-testid="plan-item-select"
                  />
                )}
                <span className="text-sm font-semibold text-muted-foreground">{index + 1}.</span>
                <Badge variant="secondary">{typeLabel(item.type)}</Badge>
              </div>
              <p className="m-0 text-sm text-muted-foreground" data-testid="plan-item-based-on">
                Based on{" "}
                <Link
                  href={`/projects/${encodeURIComponent(instanceId)}/missions/${encodeURIComponent(item.basedOn)}`}
                  className="underline"
                >
                  {item.basedOnNumber !== undefined ? `Mission #${item.basedOnNumber}` : "a Mission"}
                </Link>
              </p>
              <p className="m-0 text-sm text-foreground">{item.reason}</p>
              <PlanFigures figures={item.figures} testId="plan-item-figures" />
              <details>
                <summary className="cursor-pointer text-sm text-muted-foreground">Payload</summary>
                <pre className="mt-2 overflow-x-auto rounded-lg bg-muted p-3 text-xs text-foreground">
                  {JSON.stringify(item.payload, null, 2)}
                </pre>
              </details>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}
