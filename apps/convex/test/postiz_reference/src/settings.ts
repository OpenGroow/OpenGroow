import type { PublisherResult } from "@opengroow/publisher-sdk";

// Postiz requires per-platform `settings` on every post
// (https://docs.postiz.com/public-api/providers/<provider>). OpenGroow supplies
// working defaults so a channel needs no manual setup; settings stored on the
// channel (Publishers page) override them. Only Pinterest needs real input from
// the owner: the board to pin to. YouTube needs a title: the Publishable's, or
// the first line of its caption.

type Settings = Record<string, unknown>;

function text(value: unknown, max: number): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, max) : undefined;
}

/** The `settings` object of a Postiz post for one channel. */
export function postizSettings(
  service: string,
  publishable: Record<string, unknown>,
  stored: Settings | undefined,
  /** The uploaded cover, for the services that take a custom thumbnail (YouTube). */
  thumbnail?: { id: string; path: string },
): PublisherResult<{ settings: Settings }> {
  const kind = publishable.kind;
  const title = text(publishable.title, 100);
  const link = text(publishable.link, 2048);
  const tags = Array.isArray(publishable.tags)
    ? publishable.tags.filter((t): t is string => typeof t === "string" && t.trim() !== "")
    : [];
  let defaults: Settings = {};

  switch (service) {
    case "instagram":
    case "instagram-standalone":
      // A Reel is a single video posted as a feed post.
      defaults = { post_type: "post", is_trial_reel: false, collaborators: [] };
      break;
    case "tiktok": {
      defaults = {
        privacy_level: "PUBLIC_TO_EVERYONE",
        comment: true,
        brand_content_toggle: false,
        brand_organic_toggle: false,
        content_posting_method: "DIRECT_POST",
        // Postiz requires duet and stitch as booleans on every TikTok post, photos included (TikTok ignores
        // them there); autoAddMusic only applies to photos (image, carousel).
        ...(kind === "video" ? { duet: true, stitch: true } : { duet: false, stitch: false, autoAddMusic: "no" }),
        ...(title ? { title: title.slice(0, 90) } : {}),
      };
      break;
    }
    case "pinterest":
      defaults = { ...(title ? { title } : {}), ...(link ? { link } : {}) };
      break;
    case "youtube": {
      const caption = typeof publishable.caption === "string" ? publishable.caption : "";
      const fallback = text(caption.split("\n").find((line) => line.trim() !== ""), 100);
      defaults = {
        // Visibility is required by Postiz's YouTube provider.
        type: "public",
        ...(title ?? fallback ? { title: title ?? fallback } : {}),
        ...(tags.length > 0 ? { tags: tags.map((value) => ({ value, label: value })) } : {}),
        ...(thumbnail ? { thumbnail } : {}),
      };
      break;
    }
  }

  // `__type` last: a stored value (copied from another channel) never changes the provider.
  const settings: Settings = { ...defaults, ...(stored ?? {}), __type: service };
  if (service === "tiktok") {
    // The channel stores every TikTok option; autoAddMusic only goes with a photo post.
    if (kind === "video") delete settings.autoAddMusic;
    // Postiz refuses a post whose duet or stitch is not a boolean (400), photos included.
    for (const key of ["duet", "stitch"] as const) if (typeof settings[key] !== "boolean") settings[key] = false;
  }
  if (service === "pinterest" && !settings.board) {
    return { ok: false, error: "Pinterest needs a board: set the Board ID of this channel on the Publishers page" };
  }
  if (service === "youtube" && (typeof settings.title !== "string" || settings.title.trim() === "")) {
    return { ok: false, error: "YouTube needs a title: give the video a title or a caption" };
  }
  return { ok: true, settings };
}
