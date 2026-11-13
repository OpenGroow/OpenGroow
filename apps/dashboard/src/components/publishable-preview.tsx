"use client";

import { useEffect, useState } from "react";
import { useAction } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { Card } from "@/components/ui/card";
import { WorkspaceMarkdown } from "@/src/components/workspace-markdown";

/**
 * Preview of a Publishable (ADR-069) built from its references only: media is
 * loaded by the browser from the URLs the Agent returned, never copied through
 * OpenGroow (ADR-010). Only http(s) URLs are rendered.
 */

type PreviewProps = { publishable: unknown; missionId: string };

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function httpUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? value : null;
  } catch {
    return null;
  }
}

const KIND_LABEL: Record<string, string> = {
  video: "Final video",
  image: "Final image",
  carousel: "Final carousel",
  article: "Final article",
};

type MarkdownState = { status: "loading" } | { status: "loaded"; content: string } | { status: "failed" };

/** The markdown of an article, read by Convex from its public URL (ADR-074): the dashboard talks only to Convex. */
function useArticleMarkdown(missionId: string, markdownUrl: string | null): MarkdownState {
  const loadArticleMarkdown = useAction(api.mission_articles.loadMarkdown);
  const [state, setState] = useState<MarkdownState>({ status: "loading" });
  useEffect(() => {
    let current = true;
    setState({ status: "loading" });
    loadArticleMarkdown({ missionId: missionId as Id<"missions"> })
      .then((result) => current && setState({ status: "loaded", content: result.content }))
      .catch(() => current && setState({ status: "failed" }));
    return () => {
      current = false;
    };
    // loadArticleMarkdown is omitted: useAction returns a stable reference. A new markdownUrl reloads it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [missionId, markdownUrl]);
  return state;
}

function ArticlePreview({ p, missionId }: { p: Record<string, unknown>; missionId: string }) {
  const markdownUrl = httpUrl(p.markdownUrl);
  const cover = httpUrl(p.coverUrl);
  const markdown = useArticleMarkdown(missionId, markdownUrl);
  return (
    <Card className="grid min-w-0 gap-4 p-6" data-testid="publishable-preview">
      <h2 className="m-0 text-lg font-semibold text-foreground">{KIND_LABEL.article}</h2>
      {cover && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={cover} alt="Article cover" className="w-full rounded-xl border border-border object-cover" />
      )}
      <div className="grid gap-1">
        <p className="m-0 text-xl font-semibold text-foreground">{text(p.title)}</p>
        <p className="m-0 text-sm text-muted-foreground">{text(p.description)}</p>
        <p className="m-0 text-xs text-muted-foreground">
          /{text(p.slug)}
          {text(p.category) && <> · {text(p.category)}</>}
        </p>
      </div>
      <div className="border-t border-border pt-4">
        {markdown.status === "loading" && <p className="m-0 text-sm text-muted-foreground">Loading article…</p>}
        {markdown.status === "loaded" && <WorkspaceMarkdown content={markdown.content} />}
        {markdown.status === "failed" && (
          <p className="m-0 text-sm text-status-warning" data-testid="publishable-article-error">
            The article could not be loaded
            {markdownUrl && (
              <>
                {" "}from{" "}
                <a href={markdownUrl} target="_blank" rel="noreferrer" className="underline underline-offset-4">
                  its URL
                </a>
              </>
            )}
            .
          </p>
        )}
      </div>
    </Card>
  );
}

export function PublishablePreview({ publishable, missionId }: PreviewProps) {
  if (!publishable || typeof publishable !== "object") return null;
  const p = publishable as Record<string, unknown>;
  const kind = typeof p.kind === "string" ? p.kind : "";
  if (!(kind in KIND_LABEL)) return null;
  if (kind === "article") return <ArticlePreview p={p} missionId={missionId} />;

  const caption = text(p.caption);
  const title = text(p.title);

  const imageOf = (src: string, alt: string, className: string) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={alt} className={className} />
  );
  const imageMedia = (value: unknown) => {
    const src = httpUrl(value);
    return src ? imageOf(src, "Image to publish", "mx-auto max-h-[70vh] w-auto max-w-full rounded-xl object-contain") : null;
  };
  const carouselMedia = (value: unknown) => {
    if (!Array.isArray(value)) return null;
    const slides = value.map(httpUrl).filter((url): url is string => url !== null);
    return (
      <div className="grid gap-4 sm:grid-cols-2">
        {slides.map((src, index) => (
          <span key={`${index}-${src}`}>{imageOf(src, `Slide ${index + 1}`, "w-full rounded-xl border border-border object-contain")}</span>
        ))}
      </div>
    );
  };

  let media: React.ReactNode = null;
  if (kind === "video") {
    const src = httpUrl(p.videoUrl);
    const poster = httpUrl(p.coverUrl) ?? undefined;
    if (src) {
      // A reel is vertical: keep it to a readable size, centered on black, instead of the full width of the card.
      media = (
        <div className="flex justify-center overflow-hidden rounded-xl bg-black">
          <video
            controls
            src={src}
            poster={poster}
            className="max-h-[70vh] w-auto max-w-full"
            data-testid="publishable-video"
          />
        </div>
      );
    }
  } else if (kind === "image") {
    media = imageMedia(p.imageUrl);
  } else if (kind === "carousel") {
    media = carouselMedia(p.slideUrls);
  }

  // Variants (ADR-073): the same content made for each service, with its own text.
  const variants =
    (kind === "image" || kind === "carousel") && p.variants && typeof p.variants === "object"
      ? Object.entries(p.variants as Record<string, Record<string, unknown>>)
      : [];

  return (
    <Card className="grid min-w-0 gap-4 p-6" data-testid="publishable-preview">
      <h2 className="m-0 text-lg font-semibold text-foreground">{KIND_LABEL[kind]}</h2>
      {title && <p className="m-0 text-sm font-semibold text-foreground">{title}</p>}
      {media ?? (variants.length === 0 && <p className="m-0 text-sm text-muted-foreground">No previewable media.</p>)}
      {variants.map(([service, variant]) => (
        <section key={service} className="grid gap-3 border-t border-border pt-4" data-testid={`publishable-variant-${service}`}>
          <h3 className="m-0 text-sm font-semibold capitalize text-foreground">{service}</h3>
          {typeof variant.title === "string" && variant.title && (
            <p className="m-0 text-sm font-semibold text-foreground">{variant.title}</p>
          )}
          {kind === "image" ? imageMedia(variant.imageUrl) : carouselMedia(variant.slideUrls)}
          {typeof variant.caption === "string" && variant.caption && (
            <p className="m-0 whitespace-pre-wrap text-sm text-foreground">{variant.caption}</p>
          )}
        </section>
      ))}
      {caption && <p className="m-0 whitespace-pre-wrap text-sm text-foreground">{caption}</p>}
    </Card>
  );
}
