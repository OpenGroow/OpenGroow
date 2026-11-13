"use client";

import { useState } from "react";
import { useInstalledPublisher } from "@/src/hooks/use-installed-publishers";

const PLATFORM_NAMES: Record<string, string> = { tiktok: "TikTok", linkedin: "LinkedIn", youtube: "YouTube", x: "X", github: "GitHub" };

export function platformName(service: string): string {
  return PLATFORM_NAMES[service] ?? service.charAt(0).toUpperCase() + service.slice(1);
}

/**
 * The logo of a channel's platform. Postiz serves one per platform next to its API
 * (`<host>/icons/platforms/<service>.png`); a Publisher that serves none (GitHub: one
 * platform, the service itself) shows its package's icon instead (ADR-075).
 */
export function PlatformLogo({
  baseUrl,
  service,
  adapter,
  className = "size-10",
}: {
  baseUrl: string;
  service?: string;
  /** The adapter of the channel's Publisher: its package icon is the fallback. */
  adapter?: string;
  className?: string;
}) {
  const [broken, setBroken] = useState(false);
  const packageIcon = useInstalledPublisher(adapter)?.icon;
  if (service && broken && packageIcon) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={packageIcon} alt="" className={`${className} shrink-0 rounded-lg object-contain`} />;
  }
  if (!service || broken) return <span className={`${className} shrink-0 rounded-lg bg-muted`} aria-hidden="true" />;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`${baseUrl.replace(/\/+$/, "")}/icons/platforms/${encodeURIComponent(service)}.png`}
      alt=""
      className={`${className} shrink-0 rounded-lg object-contain`}
      onError={() => setBroken(true)}
    />
  );
}
