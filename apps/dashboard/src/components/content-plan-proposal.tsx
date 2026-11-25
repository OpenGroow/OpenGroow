"use client";

import { useState, type ReactNode } from "react";
import { BookOpen, CalendarDays, ChevronDown, ChevronUp, FileText, Film, Layers, Link2, Send, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { StatusBadge } from "@/components/opengroow/status-badge";
import { ContentEditor } from "@/src/components/content-plan-edit";
import { formatDay, type PlannedContentView } from "@/src/components/content-plan-types";

// One proposed content of the draft Content Plan, as a nested card (ADR-086).

function Detail({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) {
  return (
    <div className="flex items-start gap-2">
      <dt className="flex w-40 shrink-0 items-center gap-2 text-muted-foreground [&_svg]:size-4">
        {icon}
        {label}
      </dt>
      <dd className="m-0 min-w-0 break-words">{children}</dd>
    </div>
  );
}

/** A full-width collapsible row: one-line preview of the brief when collapsed, the whole text when expanded. */
function ProductionBrief({ brief }: { brief: string }) {
  const [open, setOpen] = useState(false);
  const Chevron = open ? ChevronUp : ChevronDown;
  return (
    <div className="grid gap-2">
      <Button type="button" variant="outline" aria-expanded={open} className="w-full justify-start gap-2" onClick={() => setOpen(!open)}>
        <Chevron aria-hidden="true" />
        <FileText aria-hidden="true" />
        <span>Production brief</span>
        {open ? null : <span className="ml-auto min-w-0 truncate font-normal text-muted-foreground">{brief}</span>}
      </Button>
      {open ? (
        <p aria-label="Full production brief" className="m-0 whitespace-pre-wrap text-sm text-muted-foreground">
          {brief}
        </p>
      ) : null}
    </div>
  );
}

export function PlannedContentCard({ content, period, readOnly = false }: { content: PlannedContentView; period: { periodStart: string; periodEnd: string }; readOnly?: boolean }) {
  const removed = content.status === "rejected";
  return (
    <li data-content={content._id}>
      <Card className={`grid gap-4 p-4 sm:p-5${removed ? " opacity-60" : ""}`}>
        <div className="flex items-start gap-3">
          <div aria-hidden="true" className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Film className="size-5" />
          </div>
          <div className="grid gap-2">
            <h3 className="m-0 text-lg font-semibold">{content.title}</h3>
            <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <CalendarDays aria-hidden="true" className="size-4" />
                {formatDay(content.plannedAt)}
              </span>
              <StatusBadge tone={content.intent === "explore" ? "info" : "neutral"} label={content.intent === "explore" ? "Explore" : "Exploit"} />
              <Badge variant="tag" size="xs">
                <Film aria-hidden="true" />
                {content.kind}
              </Badge>
              {removed ? <StatusBadge tone="neutral" label="Removed" /> : null}
            </div>
          </div>
        </div>
        <div className="grid gap-4 border-t border-border pt-4 md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
          <dl className="m-0 grid content-start gap-2 text-sm">
            <Detail icon={<BookOpen aria-hidden="true" />} label="Recipe">
              {content.recipe?.name ?? "Deleted"}
            </Detail>
            <Detail icon={<Layers aria-hidden="true" />} label="Creative Family">
              {content.creativeFamily?.name ?? "Deleted"}
            </Detail>
            {content.source ? (
              <Detail icon={<Link2 aria-hidden="true" />} label="Source">
                {content.source.label}
              </Detail>
            ) : null}
            <Detail icon={<Send aria-hidden="true" />} label="Publish targets">
              <ul aria-label="Publish targets" className="m-0 flex list-none flex-wrap gap-2 p-0">
                {content.publishTargets.map((target) => (
                  <li key={target.target} data-target={target.target} className="flex flex-wrap items-center gap-2">
                    <Badge variant="tag" size="xs">
                      {target.target}
                    </Badge>
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
            </Detail>
          </dl>
          <div aria-hidden="true" className="hidden w-px bg-border md:block" />
          <div className="grid content-start gap-1 border-t border-border pt-4 md:border-t-0 md:pt-0">
            <p className="m-0 flex items-center gap-2 text-sm font-semibold">
              <Sparkles aria-hidden="true" className="size-4 text-primary" />
              Why this content?
            </p>
            <p className="m-0 text-sm text-muted-foreground">{content.rationale}</p>
          </div>
        </div>
        <ProductionBrief brief={content.brief} />
        {removed || readOnly ? null : <ContentEditor content={content} period={period} />}
      </Card>
    </li>
  );
}
