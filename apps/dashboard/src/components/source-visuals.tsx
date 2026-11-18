"use client";

import { useEffect, useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { Hourglass, Image as ImageIcon, Images, Music2, Video } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { InstagramLogo, TikTokLogo } from "@/src/components/social-platform-icons";

// What the pieces below read from a Source: both the Sources list and the
// Source page satisfy it.
export type VisualSource = {
  _id: string;
  sourceId: string;
  label: string;
  family: string;
  analysis?: unknown;
  thumbnailUrl?: string | null;
  thumbnailTriedAt?: number;
};

// The Source family reads as words: `social-video` is "Social Video".
export function humanize(value: string): string {
  return value
    .split(/[-_]/)
    .filter(Boolean)
    .map((word) => word[0]!.toUpperCase() + word.slice(1))
    .join(" ");
}

// The leading tile of a Source with no image: the kind of content its family names.
export function SourceGlyph({ family, className = "size-14" }: { family: string; className?: string }) {
  const Icon = /tiktok|music|audio/i.test(family) ? Music2 : Video;
  return (
    <span
      aria-hidden="true"
      className={cn("flex shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground", className)}
    >
      <Icon className="size-6" />
    </span>
  );
}

// The page's own image when one was fetched, else the glyph of its family.
export function SourceThumbnail({ source, className = "size-14" }: { source: VisualSource; className?: string }) {
  const [broken, setBroken] = useState(false);
  if (!source.thumbnailUrl || broken) return <SourceGlyph family={source.family} className={className} />;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={source.thumbnailUrl} alt="" className={cn("shrink-0 rounded-xl object-cover", className)} loading="lazy" onError={() => setBroken(true)} />
  );
}

// Asks the server for the thumbnails of the Sources on screen that never had one
// (images are copied server side; a Source without one keeps its glyph).
export function useThumbnailRequests(instanceId: string, rows: VisualSource[]): void {
  const requestThumbnails = useMutation(api.source_thumbnails.request);
  const missingKey = rows
    .filter((source) => !source.thumbnailUrl && source.thumbnailTriedAt === undefined)
    .map((source) => source._id)
    .join(",");
  useEffect(() => {
    if (missingKey === "") return;
    void requestThumbnails({ instanceId, sourceIds: missingKey.split(",") as Id<"sources">[] }).catch(() => undefined);
  }, [missingKey, instanceId, requestThumbnails]);
}

export type SourceFormat = { platform?: "Instagram" | "TikTok"; media?: "video" | "image" | "carousel"; label: string };

// The platform the Source came from and the kind of media it is. `label` says
// it in words ("Instagram Reel"); it falls back to the declared label when the
// platform or media is not known.
export function formatOf(source: VisualSource): SourceFormat {
  const platform = source.sourceId === "instagram-reel" ? "Instagram" : source.sourceId === "tiktok-post" ? "TikTok" : undefined;
  const features = (source.analysis as { creativeFeatures?: { mediaType?: unknown } } | undefined)?.creativeFeatures;
  const media = features?.mediaType === "video" || features?.mediaType === "image" || features?.mediaType === "carousel" ? features.mediaType : undefined;
  if (!platform || !media) return { ...(platform ? { platform } : {}), ...(media ? { media } : {}), label: source.label };
  const noun = media === "video" ? (platform === "Instagram" ? "Reel" : "video") : media;
  return { platform, media, label: `${platform} ${noun}` };
}

const MEDIA_ICONS = { video: Video, image: ImageIcon, carousel: Images } as const;

export function PlatformMark({ platform }: { platform?: SourceFormat["platform"] }) {
  return platform === "Instagram" ? <InstagramLogo /> : platform === "TikTok" ? <TikTokLogo /> : null;
}

// The platform logo and a media icon, the words only for a tooltip and screen readers.
export function FormatBadge({ source }: { source: VisualSource }) {
  const { platform, media, label } = formatOf(source);
  if (!platform && !media) return <Badge variant="outline">{label}</Badge>;
  const MediaIcon = media ? MEDIA_ICONS[media] : undefined;
  return (
    <Badge variant="outline" title={label} className="gap-2">
      <PlatformMark platform={platform} />
      {MediaIcon ? <MediaIcon aria-hidden="true" className="size-4" /> : null}
      <span className="sr-only">{label}</span>
    </Badge>
  );
}

const NOT_SCORED_HINT = "Not scored yet. Run the Source scoring job to score it.";

// Stands where the score will be: hover (or focus) it to read what to do.
export function NotScoredHint() {
  return (
    <Tooltip>
      <TooltipTrigger
        delay={100}
        aria-label={NOT_SCORED_HINT}
        data-testid="not-scored-hint"
        // Above the row's full-size link, or that link takes the hover.
        render={<span tabIndex={0} className="relative z-10 inline-flex text-muted-foreground" />}
      >
        <Hourglass className="size-4" />
      </TooltipTrigger>
      <TooltipContent>{NOT_SCORED_HINT}</TooltipContent>
    </Tooltip>
  );
}
