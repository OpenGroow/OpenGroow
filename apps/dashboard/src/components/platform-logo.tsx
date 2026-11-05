"use client";

import { useState } from "react";

const PLATFORM_NAMES: Record<string, string> = { tiktok: "TikTok", linkedin: "LinkedIn", youtube: "YouTube", x: "X" };

export function platformName(service: string): string {
  return PLATFORM_NAMES[service] ?? service.charAt(0).toUpperCase() + service.slice(1);
}

/** Postiz serves the logo of each platform next to its API (`<host>/icons/platforms/<service>.png`). */
export function PlatformLogo({
  baseUrl,
  service,
  className = "size-10",
}: {
  baseUrl: string;
  service?: string;
  className?: string;
}) {
  const [broken, setBroken] = useState(false);
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
