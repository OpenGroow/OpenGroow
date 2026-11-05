import type { PublisherResult } from "./adapter.js";

// Postiz requires per-platform `settings` on every post
// (https://docs.postiz.com/public-api/providers/<provider>). OpenGroow supplies
// working defaults so a channel needs no manual setup; settings stored on the
// channel (Publishers page) override them. Only Pinterest needs real input from
// the owner: the board to pin to.

type Settings = Record<string, unknown>;

function text(value: unknown, max: number): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, max) : undefined;
}

/** The `settings` object of a Postiz post for one channel. */
export function postizSettings(
  service: string,
  publishable: Record<string, unknown>,
  stored: Settings | undefined,
): PublisherResult<{ settings: Settings }> {
  const kind = publishable.kind;
  const title = text(publishable.title, 100);
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
        // duet and stitch apply to videos, autoAddMusic to photos (image, carousel).
        ...(kind === "video" ? { duet: true, stitch: true } : { autoAddMusic: "no" }),
        ...(title ? { title: title.slice(0, 90) } : {}),
      };
      break;
    }
    case "pinterest":
      defaults = { ...(title ? { title } : {}) };
      break;
    case "youtube":
      if (title) defaults = { title };
      break;
  }

  const settings: Settings = { __type: service, ...defaults, ...(stored ?? {}) };
  if (service === "pinterest" && !settings.board) {
    return { ok: false, error: "Pinterest needs a board: set the Board ID of this channel on the Publishers page" };
  }
  return { ok: true, settings };
}
