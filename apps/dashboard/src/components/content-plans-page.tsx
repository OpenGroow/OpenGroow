"use client";

import { use, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { extractConvexErrorMessage } from "@/src/lib/convex-error";
import { PageHeader } from "@/components/opengroow/page-header";
import { StatusBadge } from "@/components/opengroow/status-badge";
import { ContentEditor } from "@/src/components/content-plan-edit";
import { WorkspaceMarkdown } from "@/src/components/workspace-markdown";

// The Content Plans page (ADR-086): the current draft Content Plan to review, then the history of approved and
// rejected plans. Review actions (edit, approve, reject) are added to this page by later tickets.

export type PublishTargetView = { target: string; uncertain: boolean; unavailable?: boolean; unsupported?: boolean; reason?: string };

export type PlannedContentView = {
  _id: string;
  kind: string;
  missionType: string;
  title: string;
  brief: string;
  plannedAt: string;
  intent: "explore" | "exploit";
  rationale: string;
  status: string;
  publishTargets: PublishTargetView[];
  recipe: { id: string; name: string } | null;
  creativeFamily: { id: string; name: string } | null;
  source: { id: string; label: string } | null;
};

export type DraftPlanView = {
  _id: string;
  periodStart: string;
  periodEnd: string;
  rationale: string;
  status: "draft";
  createdAt: number;
  contents: PlannedContentView[];
  quantities: Array<{ kind: string; count: number }>;
  distribution: { explore: number; exploit: number };
};

export type PlanHistoryView = {
  _id: string;
  periodStart: string;
  periodEnd: string;
  rationale: string;
  status: "approved" | "rejected";
  createdAt: number;
  counts: { total: number; approved: number; rejected: number };
};

const formatDay = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", { dateStyle: "medium", timeZone: "UTC" });
const formatTimestamp = (timestamp: number) => new Date(timestamp).toLocaleDateString("en-US", { dateStyle: "medium" });
const periodLabel = (plan: { periodStart: string; periodEnd: string }) => `${formatDay(plan.periodStart)} to ${formatDay(plan.periodEnd)}`;
/** The period is inclusive and in UTC: a draft is stale from the day after its last day. Nothing expires. */
const isStale = (plan: { periodEnd: string }, now: Date) => now.toISOString().slice(0, 10) > plan.periodEnd;

type Props = { params: Promise<{ instanceId: string }> };

export function ContentPlansPage({ params }: Props) {
  const { instanceId } = use(params);
  return <ContentPlansContent instanceId={decodeURIComponent(instanceId)} />;
}

export function ContentPlansContent({ instanceId }: { instanceId: string }) {
  const draft = useQuery(api.content_plan_review.current, { instanceId }) as DraftPlanView | null | undefined;
  const history = useQuery(api.content_plan_review.history, { instanceId }) as PlanHistoryView[] | undefined;

  return (
    <div className="grid gap-8">
      <PageHeader title="Content Plans" description="The contents your Planning Agent proposes for the coming period, and the plans you have already decided on." />
      <section aria-label="Current draft" className="grid gap-3">
        <h2 className="m-0 text-xl font-semibold">Current draft</h2>
        {draft === undefined ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : draft === null ? (
          <Card className="grid gap-2 p-6">
            <p className="m-0 text-base font-semibold">No draft Content Plan</p>
            <p className="m-0 text-sm text-muted-foreground">
              Content Plans are produced by a Content Planning Job. Schedule one or run it now from the{" "}
              <Link href={`/projects/${encodeURIComponent(instanceId)}/jobs`} className="text-primary underline underline-offset-4">
                Jobs
              </Link>{" "}
              page.
            </p>
          </Card>
        ) : (
          <DraftPlan draft={draft} />
        )}
      </section>
      <section aria-label="History" className="grid gap-3">
        <h2 className="m-0 text-xl font-semibold">History</h2>
        {history === undefined ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : history.length === 0 ? (
          <p className="m-0 text-sm text-muted-foreground">No approved or rejected plan yet.</p>
        ) : (
          <ul className="m-0 grid list-none gap-3 p-0">
            {history.map((plan) => (
              <li key={plan._id} data-plan={plan._id}>
                <Card className="grid gap-2 p-4">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="text-base font-semibold">{periodLabel(plan)}</span>
                    <StatusBadge tone={plan.status === "approved" ? "active" : "neutral"} label={plan.status === "approved" ? "Approved" : "Rejected"} />
                    <span className="text-sm text-muted-foreground">
                      Planned {formatTimestamp(plan.createdAt)} · {plan.counts.total} {plan.counts.total === 1 ? "content" : "contents"}
                      {plan.status === "approved" ? `, ${plan.counts.approved} approved` : ""}
                    </span>
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function DraftPlan({ draft }: { draft: DraftPlanView }) {
  const stale = isStale(draft, new Date());
  return (
    <div className="grid gap-4">
      {stale ? (
        <Card role="alert" className="grid gap-1 border-status-warning/40 p-4">
          <p className="m-0 text-base font-semibold">This draft's period has passed</p>
          <p className="m-0 text-sm text-muted-foreground">
            Its Planning period ended on {formatDay(draft.periodEnd)}. The draft stays until you decide on it; some proposed dates are in the past.
          </p>
        </Card>
      ) : null}
      <Card className="grid gap-4 p-6">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-base font-semibold">Planning period {periodLabel(draft)}</span>
          <StatusBadge tone="info" label="Draft" />
        </div>
        <section aria-label="Rationale">
          <WorkspaceMarkdown content={draft.rationale} />
        </section>
        <div className="flex flex-wrap gap-x-8 gap-y-2 text-sm">
          <ul aria-label="Quantities by format" className="m-0 flex list-none flex-wrap gap-x-4 gap-y-1 p-0">
            {draft.quantities.map(({ kind, count }) => (
              <li key={kind} data-kind={kind}>
                <span className="font-semibold">{count}</span> {kind}
              </li>
            ))}
          </ul>
          <p aria-label="Exploration and exploitation" className="m-0">
            <span className="font-semibold">{draft.distribution.explore}</span> exploring · <span className="font-semibold">{draft.distribution.exploit}</span> exploiting
          </p>
        </div>
        <PlanDecision planId={draft._id} />
      </Card>
      <ul className="m-0 grid list-none gap-3 p-0">
        {draft.contents.map((content) => (
          <PlannedContentCard key={content._id} content={content} period={draft} />
        ))}
      </ul>
    </div>
  );
}

function PlannedContentCard({ content, period }: { content: PlannedContentView; period: { periodStart: string; periodEnd: string } }) {
  const removed = content.status === "rejected";
  return (
    <li data-content={content._id}>
      <Card className={`grid gap-3 p-4${removed ? " opacity-60" : ""}`}>
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-base font-semibold">{content.title}</span>
          <span className="text-sm text-muted-foreground">{formatDay(content.plannedAt)}</span>
          <StatusBadge tone={content.intent === "explore" ? "info" : "neutral"} label={content.intent === "explore" ? "Explore" : "Exploit"} />
          <StatusBadge tone="neutral" label={content.kind} />
          {removed ? <StatusBadge tone="neutral" label="Removed" /> : null}
        </div>
        <p className="m-0 text-sm">{content.brief}</p>
        <p className="m-0 text-sm text-muted-foreground">{content.rationale}</p>
        <dl className="m-0 grid gap-1 text-sm">
          <Detail label="Recipe" value={content.recipe?.name ?? "Deleted"} />
          <Detail label="Creative Family" value={content.creativeFamily?.name ?? "Deleted"} />
          {content.source ? <Detail label="Source" value={content.source.label} /> : null}
        </dl>
        <ul aria-label="Publish targets" className="m-0 flex list-none flex-wrap gap-2 p-0">
          {content.publishTargets.map((target) => (
            <li key={target.target} data-target={target.target} className="flex items-center gap-2 text-sm">
              <span>{target.target}</span>
              {target.uncertain ? (
                <StatusBadge tone="warning" label="Compatibility uncertain" />
              ) : target.unsupported ? (
                <StatusBadge tone="error" label="Not supported" />
              ) : target.unavailable ? (
                <StatusBadge tone="neutral" label="No longer available" />
              ) : null}
              {target.reason ? <span className="text-muted-foreground">{target.reason}</span> : null}
            </li>
          ))}
        </ul>
        {removed ? null : <ContentEditor content={content} period={period} />}
      </Card>
    </li>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="m-0">{value}</dd>
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
    <div className="grid gap-2">
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="accent" disabled={pending} onClick={() => void decide(approve)}>
          Approve plan
        </Button>
        <Button type="button" variant="outline" disabled={pending} onClick={() => void decide(reject)}>
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
