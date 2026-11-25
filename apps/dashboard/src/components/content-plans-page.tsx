"use client";

import { use } from "react";
import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/opengroow/page-header";
import { DraftPlan } from "@/src/components/content-plan-draft";
import { HistoryPlan } from "@/src/components/content-plan-history";
import { type DraftPlanView, type PlanHistoryView } from "@/src/components/content-plan-types";

// The Content Plans page (ADR-086): the current draft Content Plan to review, then the history of approved and
// rejected plans.

export type { DraftPlanView, PlanHistoryView, PlannedContentView, PublishTargetView } from "@/src/components/content-plan-types";

type Props = { params: Promise<{ instanceId: string }> };

export function ContentPlansPage({ params }: Props) {
  const { instanceId } = use(params);
  return <ContentPlansContent instanceId={decodeURIComponent(instanceId)} />;
}

export function ContentPlansContent({ instanceId }: { instanceId: string }) {
  const draft = useQuery(api.content_plan_review.current, { instanceId }) as DraftPlanView | null | undefined;
  const history = useQuery(api.content_plan_review.history, { instanceId }) as PlanHistoryView[] | undefined;

  return (
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-8">
      <PageHeader title="Content Plans" description="The contents your Planning Agent proposes for the coming period, and the plans you have already decided on." />
      <section aria-label="Current draft" className="grid min-w-0 gap-3">
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
      <section aria-label="History" className="grid min-w-0 gap-3">
        <h2 className="m-0 text-xl font-semibold">History</h2>
        {history === undefined ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : history.length === 0 ? (
          <p className="m-0 text-sm text-muted-foreground">No approved or rejected plan yet.</p>
        ) : (
          <ul className="m-0 grid min-w-0 list-none gap-3 p-0">
            {history.map((plan) => (
              <li key={plan._id} id={`plan-${plan._id}`} data-plan={plan._id} className="min-w-0">
                <HistoryPlan plan={plan} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
