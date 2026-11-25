"use client";

import { useState } from "react";
import { CalendarDays, Check, ChevronRight, FileText, X } from "lucide-react";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { PlannedContentCard } from "@/src/components/content-plan-proposal";
import { periodLabel, type PlanHistoryView, type PlannedContentView } from "@/src/components/content-plan-types";
import { WorkspaceMarkdown } from "@/src/components/workspace-markdown";

// One approved or rejected Content Plan of the History: a row that opens onto its rationale and its Planned
// Contents, read-only (ADR-086). The contents are fetched only once the row is opened.

const formatTimestamp = (timestamp: number) => new Date(timestamp).toLocaleDateString("en-US", { dateStyle: "medium" });

export function HistoryPlan({ plan }: { plan: PlanHistoryView }) {
  const [open, setOpen] = useState(false);
  const contents = useQuery(api.content_plan_review.planDetail, open ? { planId: plan._id as Id<"contentPlans"> } : "skip") as PlannedContentView[] | null | undefined;
  return (
    <Card className="min-w-0 gap-0 p-0">
      <button
        type="button"
        aria-expanded={open}
        aria-label={`${periodLabel(plan)}, ${plan.status === "approved" ? "approved" : "rejected"}`}
        className="flex w-full flex-wrap items-center gap-x-4 gap-y-2 rounded-xl px-5 py-4 text-left hover:bg-muted/50 focus-visible:outline-2 focus-visible:outline-ring"
        onClick={() => setOpen(!open)}
      >
        <CalendarDays aria-hidden="true" className="size-5 shrink-0 text-muted-foreground" />
        <span className="text-base font-semibold">{periodLabel(plan)}</span>
        <Badge variant="tag">
          {plan.status === "approved" ? <Check aria-hidden="true" /> : <X aria-hidden="true" />}
          {plan.status === "approved" ? "Approved" : "Rejected"}
        </Badge>
        <span className="text-sm text-muted-foreground">
          Planned {formatTimestamp(plan.createdAt)} · {plan.counts.total} {plan.counts.total === 1 ? "content" : "contents"}
        </span>
        <ChevronRight aria-hidden="true" className={`ml-auto size-4 text-muted-foreground transition-transform${open ? " rotate-90" : ""}`} />
      </button>
      {open ? (
        <div className="grid min-w-0 gap-4 border-t border-border p-5">
          <section aria-label="Rationale" className="grid min-w-0 gap-2 break-words">
            <h3 className="m-0 flex items-center gap-2 text-sm font-semibold">
              <FileText aria-hidden="true" className="size-4 text-primary" />
              Strategic rationale
            </h3>
            <WorkspaceMarkdown content={plan.rationale} />
          </section>
          {contents === undefined ? (
            <p className="m-0 text-sm text-muted-foreground">Loading…</p>
          ) : contents === null ? null : (
            <ul className="m-0 grid min-w-0 list-none gap-3 p-0 [&>li]:min-w-0">
              {contents.map((content) => (
                <PlannedContentCard key={content._id} content={content} period={plan} readOnly />
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </Card>
  );
}
