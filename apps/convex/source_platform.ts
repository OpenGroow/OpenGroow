import type { SourcePlatformDeclaration } from "@opengroow/agent-templates";

// What generic code knows about a Source's platform: nothing of its own. Every
// rule comes from the Template's declaration (ADR-077).

/** Whether `hostname` is one of `domains` or a subdomain of one. */
export function isHostIn(hostname: string, domains: readonly string[]): boolean {
  const host = hostname.toLowerCase();
  return domains.some((domain) => host === domain || host.endsWith(`.${domain}`));
}

/** Whether `url` is an https URL on one of `domains`. */
export function isHttpsOn(url: string, domains: readonly string[]): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && isHostIn(parsed.hostname, domains);
  } catch {
    return false;
  }
}

/** Cap on what a declared pattern reads, so a pathological regex stays cheap. */
const MAX_PATTERN_INPUT = 300;

/** The post identity a platform's `originPattern` captures from `host/path`, or `undefined`. */
export function capturedPostOf(platform: SourcePlatformDeclaration, hostAndPath: string): string | undefined {
  if (!platform.originPattern) return undefined;
  try {
    return new RegExp(platform.originPattern).exec(hostAndPath.slice(0, MAX_PATTERN_INPUT))?.[1] || undefined;
  } catch {
    return undefined;
  }
}

/** The prefix of a platform's dedupe keys. */
export const originKeyPrefixOf = (platform: SourcePlatformDeclaration): string => platform.name.trim().toLowerCase().replace(/\s+/g, "-");
