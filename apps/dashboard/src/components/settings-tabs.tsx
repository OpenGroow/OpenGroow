"use client";

import { usePathname } from "next/navigation";
import { TabNav } from "@/components/opengroow/tab-nav";

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
  const items = SETTINGS_PAGES.map(({ segment, label }) => ({ label, href: `${base}/${segment}` }));
  // Detail pages (e.g. a single workspace) keep their section highlighted.
  const current = items.find(({ href }) => pathname === href || pathname.startsWith(`${href}/`))?.href;

  return <TabNav items={items} current={current} label="Settings sections" />;
}
