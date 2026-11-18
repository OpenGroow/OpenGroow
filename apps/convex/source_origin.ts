import type { SourcePlatformDeclaration } from "@opengroow/agent-templates";
import { capturedPostOf, isHostIn, originKeyPrefixOf } from "./source_platform.js";

// A Source's `origin` is the URL it was captured from. The same post is shared
// with different tracking parameters and under different paths, so two
// captures of one post rarely have the same string. `originKeyOf` reduces an
// origin to what identifies the post, so a post already ingested is not
// ingested twice. What identifies a post on a platform is declared by the
// Template (`platform.originPattern`, ADR-077), never written here.

/**
 * The key of a post, or `undefined` for an origin that is not a web page (a
 * search keyword, say). Without a declared platform, or for a page its pattern
 * does not recognise, the key is the page itself.
 */
export function originKeyOf(origin: string, platform?: SourcePlatformDeclaration): string | undefined {
  let url: URL;
  try {
    url = new URL(origin.trim());
  } catch {
    return undefined;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return undefined;
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (platform && isHostIn(host, platform.pageHosts)) {
    const post = capturedPostOf(platform, `${host}${url.pathname}`);
    if (post) return `${originKeyPrefixOf(platform)}/${post}`;
  }
  // Any other page: the query can be what names it, so it stays.
  return `${host}${url.pathname.replace(/\/+$/, "")}${url.search}`;
}
