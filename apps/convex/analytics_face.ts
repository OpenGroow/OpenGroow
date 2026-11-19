import type { Doc } from "./_generated/dataModel.js";
import { isFetchableUrl } from "./analytics_thumbnails_lib.js";
import { publishableForPlatform, publishableOf } from "./publishable.js";

// What the Analytics page shows of a post, read from its Publishable.

/** Whether the image the Publishable gave can be loaded by anyone: not an address local to this machine. */
export const hasPublicThumbnail = (face: { thumbnailUrl?: string }) => Boolean(face.thumbnailUrl && isFetchableUrl(face.thumbnailUrl));

const httpUrl = (value: unknown) => (typeof value === "string" && /^https?:\/\//.test(value) ? value : undefined);

/** What the Analytics page shows of the post: its title, its kind and an image to recognise it by. */
export function postFace(mission: Doc<"missions">, platform: string | undefined) {
  const base = publishableOf(mission);
  const served = base ? publishableForPlatform(base, platform) : undefined;
  const p = served?.ok ? served.publishable : base;
  const slides = Array.isArray(p?.slideUrls) ? httpUrl(p.slideUrls[0]) : undefined;
  const thumbnailUrl = httpUrl(p?.coverUrl) ?? httpUrl(p?.imageUrl) ?? slides;
  const videoUrl = httpUrl(p?.videoUrl);
  return {
    ...(typeof p?.title === "string" && p.title.trim() ? { title: p.title.trim() } : {}),
    ...(typeof p?.kind === "string" ? { kind: p.kind } : {}),
    ...(thumbnailUrl ? { thumbnailUrl } : {}),
    // A video with no cover: the page shows its first frame.
    ...(!thumbnailUrl && p?.kind === "video" && videoUrl ? { videoUrl } : {}),
  };
}
