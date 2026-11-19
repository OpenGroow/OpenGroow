"use node";

import { v } from "convex/values";
import { internal } from "./_generated/api.js";
import { internalAction, type ActionCtx } from "./_generated/server.js";
import { extractPageImage, isFetchableUrl } from "./analytics_thumbnails_lib.js";

const FETCH_TIMEOUT_MS = 5_000;
const MAX_BODY_BYTES = 256 * 1024;
const MAX_REDIRECTS = 4;

/** The start of a page (at most 256 KB), or null. Redirects are followed by hand so each hop is checked. */
async function readPage(start: string): Promise<{ html: string; url: string } | null> {
  let url = start;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (!isFetchableUrl(url)) return null;
    // No cookie, no credential: a plain anonymous GET.
    const response = await fetch(url, { redirect: "manual", credentials: "omit", headers: { accept: "text/html" }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) return null;
      url = new URL(location, url).href;
      continue;
    }
    if (!response.ok) return null;
    return { html: await readStart(response), url };
  }
  return null;
}

async function readStart(response: Response): Promise<string> {
  if (!response.body) return (await response.text()).slice(0, MAX_BODY_BYTES);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let size = 0;
  while (size < MAX_BODY_BYTES) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    text += decoder.decode(value, { stream: true });
  }
  await reader.cancel().catch(() => undefined);
  return text;
}

/** The image of one public page; null when it has none or cannot be read. Never throws. */
async function imageOf(pageUrl: string): Promise<string | null> {
  try {
    const page = await readPage(pageUrl);
    return page ? extractPageImage(page.html, page.url) : null;
  } catch {
    return null;
  }
}

/** Looks up the thumbnails of the Project's articles that have none yet. Called by Refresh. */
export async function fillThumbnails(ctx: ActionCtx, instanceId: string): Promise<void> {
  const todo = await ctx.runQuery(internal.analytics_thumbnails.pending, { instanceId, now: Date.now() });
  if (todo.length === 0) return;
  const entries = await Promise.all(todo.map(async (item) => ({ publicationId: item.publicationId, url: await imageOf(item.url) })));
  await ctx.runMutation(internal.analytics_thumbnails.store, { entries });
}

export const fill = internalAction({
  args: { instanceId: v.string() },
  handler: async (ctx, args) => {
    await fillThumbnails(ctx, args.instanceId);
  },
});
