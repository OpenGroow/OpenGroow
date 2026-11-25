"use client";

import { useState } from "react";
import { CalendarDays, Check, ChevronDown, Compass, FileText, Film, Target, X } from "lucide-react";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { StatusBadge } from "@/components/opengroow/status-badge";
import { PlannedContentCard } from "@/src/components/content-plan-proposal";
import { formatDay, periodLabel, type DraftPlanView } from "@/src/components/content-plan-types";
import { extractConvexErrorMessage } from "@/src/lib/convex-error";
import { WorkspaceMarkdown } from "@/src/components/workspace-markdown";

/** The period is inclusive and in UTC: a draft is stale from the day after its last day. Nothing expires. */
const isStale = (plan: { periodEnd: string }, now: Date) => now.toISOString().slice(0, 10) > plan.periodEnd;

/** The plan's Markdown rationale: a two-line preview, expanded for good by "Show more". */
function PlanRationale({ rationale }: { rationale: string }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <section aria-label="Rationale" className="grid items-start gap-2 md:grid-cols-[12rem_minmax(0,1fr)_auto] md:gap-4">
      <h3 className="m-0 flex items-center gap-2 text-sm font-semibold">
        <FileText aria-hidden="true" className="size-4 text-primary" />
        Strategic rationale
      </h3>
      {expanded ? (
        <WorkspaceMarkdown content={rationale} />
      ) : (
        <div
          data-clamped="true"
          className="max-h-11 min-w-0 overflow-hidden break-words text-sm text-muted-foreground [mask-image:linear-gradient(to_bottom,black_55%,transparent)] [&_*]:m-0"
        >
          <WorkspaceMarkdown content={rationale} />
        </div>
      )}
      {expanded ? null : (
        <Button type="button" variant="link" size="sm" aria-expanded={false} className="w-fit" onClick={() => setExpanded(true)}>
          Show more
          <ChevronDown aria-hidden="true" />
        </Button>
      )}
    </section>
  );
}

export function DraftPlan({ draft }: { draft: DraftPlanView }) {
  const stale = isStale(draft, new Date());
  const kept = draft.contents.filter((content) => content.status !== "rejected").length;
  return (
    <div className="grid min-w-0 gap-4">
      {stale ? (
        <Card role="alert" className="grid gap-1 border-status-warning/40 p-4">
          <p className="m-0 text-base font-semibold">This draft's period has passed</p>
          <p className="m-0 text-sm text-muted-foreground">
            Its Planning period ended on {formatDay(draft.periodEnd)}. The draft stays until you decide on it; some proposed dates are in the past.
          </p>
        </Card>
      ) : null}
      <Card className="grid min-w-0 gap-5 p-4 sm:p-6">
        <div aria-label="Plan summary" className="flex flex-wrap items-center gap-x-4 gap-y-3">
          <div aria-hidden="true" className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <CalendarDays className="size-5" />
          </div>
          <div className="grid gap-0.5">
            <span className="text-xs text-muted-foreground">Planning period</span>
            <span className="text-base font-semibold">{periodLabel(draft)}</span>
          </div>
          <StatusBadge tone="info" label="Draft" />
          <div aria-hidden="true" className="hidden h-8 w-px bg-border sm:block" />
          <div className="flex flex-wrap items-center gap-2">
            <Badge aria-label="Content count" variant="tag">
              <Film aria-hidden="true" />
              {kept} {kept === 1 ? "content" : "contents"}
            </Badge>
            <Badge aria-label="Exploring" variant="tag">
              <Compass aria-hidden="true" />
              {draft.distribution.explore} exploring
            </Badge>
            <Badge aria-label="Exploiting" variant="tag">
              <Target aria-hidden="true" />
              {draft.distribution.exploit} exploiting
            </Badge>
          </div>
          <PlanDecision planId={draft._id} />
        </div>
        <div className="border-t border-border pt-5">
          <PlanRationale rationale={draft.rationale} />
        </div>
        <div className="grid gap-4 border-t border-border pt-5">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h3 className="m-0 text-lg font-semibold">Planned contents ({kept})</h3>
            <p className="m-0 text-sm text-muted-foreground">The contents to create and publish under this Content Plan.</p>
          </div>
          <ul className="m-0 grid list-none gap-3 p-0">
            {draft.contents.map((content) => (
              <PlannedContentCard key={content._id} content={content} period={draft} />
            ))}
          </ul>
        </div>
      </Card>
    </div>
  );
}

/** Approve or reject the whole plan; a refusal (past date, archived Recipe, exceeded quantity…) is shown as is. */
function PlanDecision({ planId }: { planId: string }) {
  const approve = useMutation(api.content_plan_decision.approve);
  const reject = useMutation(api.content_plan_decision.reject);
  const [pending, setPending] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);

  async function decide(action: typeof approve): Promise<void> {
    setPending(true);
    setRefusal(null);
    try {
      const result = await action({ planId: planId as Id<"contentPlans"> });
      if (!result.ok) setRefusal(result.message);
    } catch (error) {
      setRefusal(extractConvexErrorMessage(error, "The decision could not be saved."));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="grid gap-2 lg:ml-auto">
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="accent" disabled={pending} onClick={() => void decide(approve)}>
          <Check aria-hidden="true" />
          Approve plan
        </Button>
        <Button type="button" variant="secondary" disabled={pending} onClick={() => void decide(reject)}>
          <X aria-hidden="true" />
          Reject plan
        </Button>
      </div>
      {refusal ? (
        <p role="alert" className="m-0 text-sm text-destructive">
          {refusal}
        </p>
      ) : null}
    </div>
  );
}
