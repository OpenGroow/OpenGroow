"use client";

import { useState } from "react";
import { platformIcon } from "@opengroow/publisher-sdk";
import { useInstalledPublisher } from "@/src/hooks/use-installed-publishers";

const PLATFORM_NAMES: Record<string, string> = { tiktok: "TikTok", linkedin: "LinkedIn", youtube: "YouTube", x: "X", github: "GitHub" };

export function platformName(service: string): string {
  return PLATFORM_NAMES[service] ?? service.charAt(0).toUpperCase() + service.slice(1);
}

/**
 * The logo of a channel's platform, shipped with its Publisher's package
 * (`capabilities.platforms.<service>.icon`), else the package's own icon: the
 * same rule for every Publisher, with no request (ADR-075). An empty tile when
 * there is neither.
 */
export function PlatformLogo({
  service,
  adapter,
  className = "size-10",
}: {
  service?: string;
  /** The adapter of the channel's Publisher. */
  adapter?: string;
  className?: string;
}) {
  const installed = useInstalledPublisher(adapter);
  const [broken, setBroken] = useState<string | null>(null);
  const src = service ? platformIcon(installed?.capabilities, service, installed?.icon) : undefined;
  if (!src || broken === src) return <span className={`${className} shrink-0 rounded-lg bg-muted`} aria-hidden="true" />;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt="" className={`${className} shrink-0 rounded-lg object-contain`} onError={() => setBroken(src)} />;
}
