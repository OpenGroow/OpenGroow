"use client";

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
  items,
  selected,
  onToggle,
  typeLabel = titleCase,
}: {
  items: PlanItemView[];
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
        <p className="m-0 text-sm text-muted-foreground">The Agent has nothing to propose.</p>
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
