"use client";

import { Card } from "@/components/ui/card";

/**
 * Preview of a Publishable (ADR-069) built from its references only: media is
 * loaded by the browser from the URLs the Agent returned, never copied through
 * OpenGroow (ADR-010). Only http(s) URLs are rendered.
 */

type PreviewProps = { publishable: unknown };

function httpUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? value : null;
  } catch {
    return null;
  }
}

const KIND_LABEL: Record<string, string> = { video: "Video", image: "Image", carousel: "Carousel" };

export function PublishablePreview({ publishable }: PreviewProps) {
  if (!publishable || typeof publishable !== "object") return null;
  const p = publishable as Record<string, unknown>;
  const kind = typeof p.kind === "string" ? p.kind : "";
  if (!(kind in KIND_LABEL)) return null;

  const caption = typeof p.caption === "string" ? p.caption : "";
  const title = typeof p.title === "string" ? p.title : "";

  let media: React.ReactNode = null;
  if (kind === "video") {
    const src = httpUrl(p.videoUrl);
    const poster = httpUrl(p.coverUrl) ?? undefined;
    if (src) {
      media = (
        <video controls src={src} poster={poster} className="w-full rounded-xl" data-testid="publishable-video" />
      );
    }
  } else if (kind === "image") {
    const src = httpUrl(p.imageUrl);
    if (src) {
      // eslint-disable-next-line @next/next/no-img-element
      media = <img src={src} alt="Image to publish" className="w-full rounded-xl object-contain" />;
    }
  } else if (kind === "carousel" && Array.isArray(p.slideUrls)) {
    const slides = p.slideUrls.map(httpUrl).filter((url): url is string => url !== null);
    media = (
      <div className="grid gap-4 sm:grid-cols-2">
        {slides.map((src, index) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={`${index}-${src}`}
            src={src}
            alt={`Slide ${index + 1}`}
            className="w-full rounded-xl border border-border object-contain"
          />
        ))}
      </div>
    );
  }

  return (
    <Card className="grid gap-4 p-6" data-testid="publishable-preview">
      <h2 className="m-0 text-lg font-semibold text-foreground">To publish: {KIND_LABEL[kind]}</h2>
      {title && <p className="m-0 text-sm font-semibold text-foreground">{title}</p>}
      {media ?? <p className="m-0 text-sm text-muted-foreground">No previewable media.</p>}
      {caption && <p className="m-0 whitespace-pre-wrap text-sm text-foreground">{caption}</p>}
    </Card>
  );
}
