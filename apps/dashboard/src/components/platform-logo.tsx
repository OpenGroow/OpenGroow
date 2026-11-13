"use client";

import { useState } from "react";
import { useInstalledPublisher } from "@/src/hooks/use-installed-publishers";

const PLATFORM_NAMES: Record<string, string> = { tiktok: "TikTok", linkedin: "LinkedIn", youtube: "YouTube", x: "X", github: "GitHub" };

export function platformName(service: string): string {
  return PLATFORM_NAMES[service] ?? service.charAt(0).toUpperCase() + service.slice(1);
}

/**
 * The image of a channel, first that loads of: the channel's own picture (the
 * account's avatar, a repository owner's avatar), the platform logo its Publisher
 * serves (Postiz: `<host>/icons/platforms/<service>.png`), the icon of its
 * Publisher's package (GitHub serves no platform logo, ADR-075). An empty tile otherwise.
 */
export function PlatformLogo({
  baseUrl,
  service,
  adapter,
  picture,
  className = "size-10",
}: {
  baseUrl: string;
  service?: string;
  /** The adapter of the channel's Publisher: its package icon is the last fallback. */
  adapter?: string;
  /** The channel's own picture, when the service gives one. */
  picture?: string;
  className?: string;
}) {
  const packageIcon = useInstalledPublisher(adapter)?.icon;
  const candidates = service
    ? [picture, `${baseUrl.replace(/\/+$/, "")}/icons/platforms/${encodeURIComponent(service)}.png`, packageIcon].filter(
        (src): src is string => Boolean(src),
      )
    : [];
  // The sources that failed to load, so a new candidate (the package icon arriving) is still tried.
  const [failed, setFailed] = useState<ReadonlySet<string>>(() => new Set());
  const src = candidates.find((candidate) => !failed.has(candidate));
  if (!src) return <span className={`${className} shrink-0 rounded-lg bg-muted`} aria-hidden="true" />;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      key={src}
      src={src}
      alt=""
      className={`${className} shrink-0 rounded-lg object-contain`}
      onError={() => setFailed((previous) => new Set(previous).add(src))}
    />
  );
}
