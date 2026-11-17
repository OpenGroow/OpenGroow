"use client";

import { useState } from "react";
import Link from "next/link";
import { Check, Lightbulb, Route, Sparkles, X } from "lucide-react";
import type { FunctionReturnType } from "convex/server";
import type { api } from "@convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { titleCase } from "@/src/lib/mission-type";
import { extractConvexErrorMessage } from "@/src/lib/convex-error";
import { ColumnShell } from "./board-column";

type Board = FunctionReturnType<typeof api.sources.listBoard>;
export type BoardSource = Board["ideas"][number];

export type UpstreamProps = {
  ideas: BoardSource[];
  toRoute: BoardSource[];
  // True when the routing Job waits for approval instead of producing at once.
  reviewRouting: boolean;
  onProduce: (sourceId: string) => Promise<void>;
  onApprove: (sourceId: string) => Promise<void>;
  onReject: (sourceId: string) => Promise<void>;
};

const PAGE_SIZE = 5;

function matches(source: BoardSource, needle: string): boolean {
  if (!needle) return true;
  const decision = source.routing;
  return [source.label, source.summary, source.origin, decision?.label, decision?.agentName, decision?.missionType, decision?.rationale]
    .some((text) => text?.toLowerCase().includes(needle));
}

export function UpstreamColumns({ projectId, query, ideas, toRoute, reviewRouting, onProduce, onApprove, onReject }: UpstreamProps & { projectId: string; query: string }) {
  const [visibleIdeas, setVisibleIdeas] = useState(PAGE_SIZE);
  const shownIdeas = ideas.filter((source) => matches(source, query));
  const shownToRoute = toRoute.filter((source) => matches(source, query));
  return (
    <>
      <ColumnShell id="ideas" label="Ideas" dot="bg-tone-blue" count={shownIdeas.length}>
        {shownIdeas.length === 0 ? (
          <EmptyColumn icon={Lightbulb} title="No ideas yet" text="Scored Sources waiting to be picked appear here." />
        ) : (
          shownIdeas.slice(0, visibleIdeas).map((source) => (
            <IdeaCard key={source._id} source={source} projectId={projectId} onProduce={onProduce} />
          ))
        )}
        {shownIdeas.length > visibleIdeas && (
          <Button variant="outline" size="sm" type="button" onClick={() => setVisibleIdeas((count) => count + PAGE_SIZE)}>
            Load more
          </Button>
        )}
      </ColumnShell>
      <ColumnShell id="to_route" label="To route" dot="bg-tone-violet" count={shownToRoute.length}>
        {shownToRoute.length === 0 ? (
          <EmptyColumn
            icon={Route}
            title="Nothing to approve"
            text={reviewRouting ? "Routing proposals wait here for your approval." : "Routing runs unattended. Turn on review in the Source routing Job to approve each choice."}
          />
        ) : (
          shownToRoute.map((source) => (
            <RouteCard key={source._id} source={source} projectId={projectId} onApprove={onApprove} onReject={onReject} />
          ))
        )}
      </ColumnShell>
    </>
  );
}

function EmptyColumn({ icon: Icon, title, text }: { icon: typeof Lightbulb; title: string; text: string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 px-3 py-10 text-center">
      <Icon aria-hidden="true" className="mb-1 size-8 text-muted-foreground" />
      <p className="m-0 text-sm font-semibold text-foreground">{title}</p>
      <p className="m-0 text-sm text-muted-foreground">{text}</p>
    </div>
  );
}

function sourceHref(projectId: string, sourceId: string): string {
  return `/projects/${encodeURIComponent(projectId)}/sources/${encodeURIComponent(sourceId)}`;
}

function scoreLabel(score: number | undefined): string | undefined {
  return score === undefined ? undefined : `${Math.round(score * 100)}`;
}

async function run(action: () => Promise<void>, fallback: string, setBusy: (busy: boolean) => void): Promise<void> {
  setBusy(true);
  try {
    await action();
  } catch (error: unknown) {
    window.alert(extractConvexErrorMessage(error, fallback));
  } finally {
    setBusy(false);
  }
}

function IdeaCard({ source, projectId, onProduce }: { source: BoardSource; projectId: string; onProduce: UpstreamProps["onProduce"] }) {
  const [busy, setBusy] = useState(false);
  const score = scoreLabel(source.score);
  return (
    <Card data-source={source._id} size="sm" className="glow-hover gap-2 px-3 py-3">
      <Link href={sourceHref(projectId, source._id)} className="flex flex-col gap-1.5 no-underline">
        <span className="break-words text-sm font-semibold text-foreground line-clamp-2">{source.summary ?? source.origin}</span>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant="outline" size="xs">{source.label}</Badge>
          {score ? <Badge variant="outline" size="xs" className="tabular-nums">Score {score}</Badge> : null}
        </div>
      </Link>
      <Button variant="outline" size="sm" type="button" disabled={busy} onClick={() => void run(() => onProduce(source._id), "Failed to start production.", setBusy)}>
        <Sparkles />
        Produce
      </Button>
    </Card>
  );
}

function publishTitle(source: BoardSource): string | undefined {
  const payload = source.routing?.payload as { publish?: { title?: unknown } } | undefined;
  return typeof payload?.publish?.title === "string" ? payload.publish.title : undefined;
}

function RouteCard({ source, projectId, onApprove, onReject }: { source: BoardSource; projectId: string; onApprove: UpstreamProps["onApprove"]; onReject: UpstreamProps["onReject"] }) {
  const [busy, setBusy] = useState(false);
  const decision = source.routing;
  if (!decision) return null;
  const title = publishTitle(source);
  const score = scoreLabel(source.score);
  return (
    <Card data-source={source._id} size="sm" className="glow-hover gap-2 px-3 py-3">
      <Link href={sourceHref(projectId, source._id)} className="flex flex-col gap-2 no-underline">
        <span className="break-words text-sm font-semibold text-foreground line-clamp-2">{source.summary ?? source.origin}</span>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge size="xs">{titleCase(decision.missionType)}</Badge>
          <Badge variant="outline" size="xs">{decision.label}</Badge>
          {score ? <Badge variant="outline" size="xs" className="tabular-nums">Score {score}</Badge> : null}
        </div>
        <p className="m-0 text-xs text-muted-foreground">Agent: {decision.agentName}</p>
        {title ? <p className="m-0 break-words text-sm text-foreground line-clamp-2">“{title}”</p> : null}
        <p className="m-0 break-words text-sm text-muted-foreground line-clamp-4">{decision.rationale}</p>
      </Link>
      <div className="flex gap-2">
        <Button size="sm" type="button" disabled={busy} className="flex-1" onClick={() => void run(() => onApprove(source._id), "Failed to approve the routing.", setBusy)}>
          <Check />
          Approve
        </Button>
        <Button variant="outline" size="sm" type="button" disabled={busy} aria-label="Reject" onClick={() => void run(() => onReject(source._id), "Failed to reject the routing.", setBusy)}>
          <X />
        </Button>
      </div>
    </Card>
  );
}
