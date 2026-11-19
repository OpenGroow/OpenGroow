// Pure helpers of the article thumbnails: no Convex runtime needed.

import { outboundUrlProblem } from "@opengroow/agent-templates";

const ENTITIES: Record<string, string> = { amp: "&", quot: '"', apos: "'", lt: "<", gt: ">" };

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, body: string) => {
    if (body[0] === "#") {
      const code = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[body.toLowerCase()] ?? whole;
  });
}

function attributesOf(tag: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  for (const m of tag.matchAll(/([^\s=<>"'/]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) {
    attributes[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? "";
  }
  return attributes;
}

/** The image a page declares for sharing: `og:image`, else `twitter:image`, as an absolute http(s) URL, or null. */
export function extractPageImage(html: string, pageUrl: string): string | null {
  const found: Record<string, string> = {};
  for (const m of html.matchAll(/<meta\b[^>]*>/gi)) {
    const attributes = attributesOf(m[0]);
    const key = (attributes.property ?? attributes.name ?? "").trim().toLowerCase();
    const content = attributes.content?.trim();
    if (content && !(key in found)) found[key] = content;
  }
  for (const key of ["og:image", "og:image:secure_url", "og:image:url", "twitter:image", "twitter:image:src"]) {
    const raw = found[key];
    if (!raw) continue;
    try {
      const url = new URL(decodeEntities(raw), pageUrl);
      if (url.protocol === "http:" || url.protocol === "https:") return url.href;
    } catch {
      // Not a URL: try the next one.
    }
  }
  return null;
}

/** Whether a page URL may be fetched: the hosted deployment's outbound policy (public http(s) only). */
export function isFetchableUrl(raw: string): boolean {
  return outboundUrlProblem(raw) === undefined;
}
