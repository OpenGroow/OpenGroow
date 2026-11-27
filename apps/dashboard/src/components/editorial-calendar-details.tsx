"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { CalendarDays, ExternalLink, FileText, Shapes, Sparkles, Target } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { StatusBadge } from "@/components/opengroow/status-badge";
import { PlatformLogo } from "@/src/components/platform-logo";
import { formatIcon } from "@/src/components/editorial-calendar-format";
import { formatDay, intentLabel } from "@/src/components/content-plan-types";
import { formatLabel, type CalendarItem, type CalendarTarget } from "@/src/components/editorial-calendar-types";

const LONG_BRIEF = 280;

/**
 * The media of a content. `thumbnailUrl` is for when a Mission has produced a media: nothing feeds it yet, so the
 * neutral placeholder with the format icon is what shows today.
 */
export function ContentThumbnail({ contentType, thumbnailUrl }: { contentType: string; thumbnailUrl?: string }) {
  const Icon = formatIcon(contentType);
  if (thumbnailUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={thumbnailUrl} alt="" className="aspect-video w-full rounded-xl border object-cover" />;
  }
  return (
    <div data-slot="content-thumbnail" aria-hidden="true" className="flex aspect-video w-full items-center justify-center rounded-xl border bg-muted/50 text-muted-foreground">
      <Icon className="size-10" />
    </div>
  );
}

function Row({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2 text-sm">
      <span className="flex items-center gap-2 text-muted-foreground [&_svg]:size-4" aria-hidden={label ? undefined : true}>
        {icon}
        {label}
      </span>
      {children}
    </div>
  );
}

function Brief({ brief }: { brief: string }) {
  const [open, setOpen] = useState(false);
  const long = brief.length > LONG_BRIEF;
  return (
    <div className="grid min-w-0 gap-1">
      <p className={`m-0 whitespace-pre-line break-words text-sm ${long && !open ? "line-clamp-4" : ""}`}>{brief}</p>
      {long ? (
        <Button type="button" variant="link" size="xs" className="w-fit px-0" onClick={() => setOpen(!open)}>
          {open ? "Show less" : "Show more"}
        </Button>
      ) : null}
    </div>
  );
}

export function Details({ item, instanceId }: { item: CalendarItem; instanceId: string }) {
  const Icon = formatIcon(item.contentType);
  const targets: CalendarTarget[] = item.targets ?? item.publishTargets.map((target) => ({ target, label: target }));
  return (
    <section aria-label="Content details" className="min-w-0">
      <Card className="grid min-w-0 gap-6 bg-gradient-to-br from-primary/10 via-card to-card p-5 lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1.4fr)]">
        <div className="grid min-w-0 content-start gap-4">
          <ContentThumbnail contentType={item.contentType} />
          <h3 className="m-0 break-words text-2xl font-semibold">{item.title}</h3>
          <div className="grid gap-2">
            <Row icon={<CalendarDays aria-hidden="true" />} label="">{formatDay(item.plannedAt)}</Row>
            <Row icon={<Shapes aria-hidden="true" />} label="Type:">
              <Badge variant="tag" size="xs"><Icon aria-hidden="true" />{formatLabel(item.contentType)}</Badge>
            </Row>
            <Row icon={<Target aria-hidden="true" />} label="Intent:">
              <StatusBadge tone={item.intent === "explore" ? "info" : "neutral"} label={intentLabel(item.intent)} />
            </Row>
          </div>
          <div className="grid gap-2 border-t pt-4">
            <h4 className="m-0 text-xs font-medium uppercase tracking-wide text-muted-foreground">Publish targets</h4>
            <ul aria-label="Publish targets" className="m-0 grid list-none gap-2 p-0">
              {targets.map((target) => (
                <li key={target.target} className="flex min-w-0 items-center gap-2 text-sm">
                  {target.service ? <PlatformLogo service={target.service} adapter={target.adapter} className="size-5" /> : null}
                  <span className="min-w-0 break-words">{target.label}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
        <div className="hidden w-px bg-border lg:block" aria-hidden="true" />
        <div className="grid min-w-0 content-start gap-5">
          <div className="grid gap-2">
            <h4 className="m-0 flex items-center gap-2 text-base font-semibold"><FileText aria-hidden="true" className="size-4" />Production Brief</h4>
            <Brief brief={item.brief} />
          </div>
          <div className="grid gap-2">
            <h4 className="m-0 flex items-center gap-2 text-base font-semibold"><Sparkles aria-hidden="true" className="size-4" />Why This Content</h4>
            <p className="m-0 whitespace-pre-line break-words text-sm text-muted-foreground">{item.rationale}</p>
          </div>
          <Button variant="outline" nativeButton={false} className="h-auto w-fit max-w-full whitespace-normal text-left" render={<Link href={`/projects/${encodeURIComponent(instanceId)}/content-plans#plan-${item.planId}`} />}>
            <ExternalLink aria-hidden="true" />
            View the originating plan{item.plan ? ` (${formatDay(item.plan.periodStart)} to ${formatDay(item.plan.periodEnd)})` : ""}
          </Button>
        </div>
      </Card>
    </section>
  );
}
