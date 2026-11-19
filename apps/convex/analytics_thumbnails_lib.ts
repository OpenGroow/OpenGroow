// Pure helpers of the article thumbnails: no Convex runtime needed.

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

/** Whether a page URL may be fetched: http(s) only, and not a local or private address literal (basic SSRF guard). */
export function isFetchableUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) return false;
  if (host.startsWith("[")) {
    const ip = host.slice(1, -1);
    if (ip === "::" || ip === "::1") return false;
    if (/^f[cd][0-9a-f]{0,2}:/.test(ip) || /^fe[89ab][0-9a-f]?:/.test(ip)) return false;
    if (ip.startsWith("::ffff:")) {
      const tail = ip.slice(7);
      const dotted = /^\d+\.\d+\.\d+\.\d+$/.test(tail) ? tail : hexMappedToDotted(tail);
      return dotted ? !isPrivateV4(dotted) : false;
    }
    return true;
  }
  // The URL parser normalises numeric hosts (0x7f.1, 2130706433) to dotted decimal.
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) return !isPrivateV4(host);
  return true;
}

function hexMappedToDotted(tail: string): string | null {
  const m = tail.match(/^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (!m) return null;
  const hi = parseInt(m[1], 16);
  const lo = parseInt(m[2], 16);
  return `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
}

function isPrivateV4(ip: string): boolean {
  const [a, b] = ip.split(".").map(Number);
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
}
