// A Source's `origin` is the URL it was captured from. The same post is shared
// with different tracking parameters (`?srtk=…`, `?igsh=…`) and, on Instagram,
// under `/p/` or `/reel/`, so two captures of one post rarely have the same
// string. `originKeyOf` reduces an origin to what identifies the post, so a
// post already ingested is not ingested twice.

const INSTAGRAM_POST = /^\/(?:[^/]+\/)?(?:p|reels?|tv)\/([A-Za-z0-9_-]+)/;
const TIKTOK_POST = /\/(?:video|photo)\/(\d+)/;

/** The key of a post, or `undefined` for an origin that is not a web page (a search keyword, say). */
export function originKeyOf(origin: string): string | undefined {
  let url: URL;
  try {
    url = new URL(origin.trim());
  } catch {
    return undefined;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return undefined;
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (host === "instagram.com") {
    const code = INSTAGRAM_POST.exec(url.pathname)?.[1];
    if (code) return `instagram.com/p/${code}`;
  }
  if (host === "tiktok.com" || host.endsWith(".tiktok.com")) {
    const id = TIKTOK_POST.exec(url.pathname)?.[1];
    if (id) return `tiktok.com/${id}`;
  }
  // Any other site: the query can be what names the page, so it stays.
  return `${host}${url.pathname.replace(/\/+$/, "")}${url.search}`;
}
