"use client";

import { useState } from "react";

/**
 * A hub package's logo: the image data URI the hub gives it, or the initial of
 * its name when it has none or the image does not load.
 */
export function PackageLogo({ icon, name, className }: { icon?: string; name: string; className: string }) {
  const [brokenIcon, setBrokenIcon] = useState<string | undefined>();
  if (!icon || brokenIcon === icon) {
    return <span className={`${className} grid place-items-center bg-muted text-sm font-semibold uppercase`} aria-hidden="true">{name.slice(0, 1)}</span>;
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={icon} alt="" className={className} onError={() => setBrokenIcon(icon)} />;
}
