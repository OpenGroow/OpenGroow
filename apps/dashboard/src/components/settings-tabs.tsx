"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const SETTINGS_PAGES = [
  { segment: "overview", label: "Overview" },
  { segment: "channels", label: "Channels" },
  { segment: "providers", label: "Providers" },
  { segment: "devices", label: "Devices" },
  { segment: "workspaces", label: "Workspaces" },
  { segment: "security", label: "Security" },
  { segment: "usage", label: "Usage" },
];

export function SettingsTabs({ projectId }: { projectId: string }) {
  const pathname = usePathname();
  const base = `/projects/${encodeURIComponent(projectId)}/settings`;

  return (
    <nav className="flex flex-wrap gap-2" aria-label="Settings sections">
      {SETTINGS_PAGES.map(({ segment, label }) => {
        const href = `${base}/${segment}`;
        const current = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={segment}
            href={href}
            aria-current={current ? "page" : undefined}
            className={cn(
              "rounded-full px-4 py-1.5 text-sm font-semibold",
              current
                ? "bg-primary/15 text-primary"
                : "text-muted-foreground hover:bg-accent",
            )}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
