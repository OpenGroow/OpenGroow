"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { use, useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  Bot,
  CalendarClock,
  LayoutGrid,
  Library,
  ListChecks,
  Menu,
  Palette,
  PanelLeftClose,
  PanelLeftOpen,
  Rocket,
  ScrollText,
  Settings,
  X,
} from "lucide-react";
import type { ComponentType } from "react";
import type { InstanceRecord, InstanceView } from "@/src/components/instance-workspace.types";
import { getWorkspaceStatusLabel } from "@/src/components/instance-workspace.utils";
import { useAuthenticatedInstances } from "@/src/hooks/use-authenticated-instances";
import { HOSTED_ONLY_VIEWS } from "@/src/lib/self-host";
import { cn } from "@/lib/utils";
import { WaitingLogsPanel } from "./waiting-logs-panel";

const NAV_LINK_BASE_CLASSES =
  "flex min-h-14 items-center gap-3.5 rounded-2xl px-4 py-3 text-left transition-[background-color,color,transform] duration-150 hover:-translate-y-px hover:text-[var(--dashboard-primary)] [&_svg]:size-[1.1rem] [&_svg]:shrink-0";

function navLinkActiveClasses(isActive: boolean) {
  return isActive
    ? "bg-[linear-gradient(135deg,rgba(188,237,215,0.92),rgba(214,236,226,0.88))] text-[var(--dashboard-primary)] shadow-[inset_0_0_0_1px_rgba(0,38,27,0.08)]"
    : "text-[var(--dashboard-ink-muted)] hover:bg-[rgba(220,230,224,0.65)]";
}

type ProjectView = {
  id: InstanceView;
  label: string;
  icon: ComponentType;
};

const PROJECT_VIEWS: ProjectView[] = [
  { id: "missions", label: "Missions", icon: Rocket },
  { id: "agents", label: "Agents", icon: Bot },
  { id: "sources", label: "Sources", icon: Library },
  { id: "jobs", label: "Jobs", icon: ListChecks },
  { id: "schedules", label: "Scheduler", icon: CalendarClock },
  { id: "brand", label: "Brand", icon: Palette },
  { id: "settings", label: "Settings", icon: Settings },
  { id: "developer", label: "Developer", icon: ScrollText },
];

function ProjectNavLinks({
  views,
  projectPath,
  activeSegment,
  collapsed,
  onNavigate,
}: {
  views: ProjectView[];
  projectPath: string;
  activeSegment: string;
  collapsed: boolean;
  onNavigate?: () => void;
}) {
  return (
    <>
      {views.map((view) => {
        const Icon = view.icon;
        return (
          <Link
            key={view.id}
            href={`${projectPath}/${view.id}`}
            onClick={onNavigate}
            title={collapsed ? view.label : undefined}
            className={cn(
              NAV_LINK_BASE_CLASSES,
              navLinkActiveClasses(activeSegment === view.id),
              collapsed && "xl:justify-center xl:px-0",
            )}
          >
            <Icon />
            <span className={collapsed ? "xl:hidden" : undefined}>{view.label}</span>
          </Link>
        );
      })}
    </>
  );
}

type LayoutProps = {
  children: ReactNode;
  params: Promise<{ projectId: string }>;
  isSelfHost: boolean;
};

export default function ProjectLayoutClient({ children, params, isSelfHost }: LayoutProps) {
  const { projectId } = use(params);
  const decodedId = decodeURIComponent(projectId);
  const pathname = usePathname();

  const instances = useAuthenticatedInstances<InstanceRecord>();
  const instance = instances?.find(
    (e) => e.openclawId === decodedId || e.jobId === decodedId,
  );
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);

  const statusLabel = instance
    ? getWorkspaceStatusLabel(
        instance.status,
        instance.runtimeStatus,
        instance.runtimeReady,
      )
    : instances
      ? "Not found"
      : "Loading…";

  const instanceAccessible = instance ? isInstanceAccessible(instance) : false;
  const projectTitle = instance?.displayName?.trim() || "Untitled Project";

  const activeSegment =
    pathname
      .slice(`/projects/${projectId}`.length)
      .split("/")
      .filter(Boolean)[0] ?? "";

  const visibleViews = useMemo(
    () => PROJECT_VIEWS.filter((view) => !isSelfHost || !HOSTED_ONLY_VIEWS.has(view.id)),
    [isSelfHost],
  );

  if (!instances) {
    return (
      <main className="min-h-screen bg-white">
        <section className="grid min-h-screen place-items-center px-6">
          <div className="w-full max-w-[720px] px-8 py-16 text-center text-[var(--dashboard-ink-muted)]">
            Loading project workspace…
          </div>
        </section>
      </main>
    );
  }

  if (instances && !instance) {
    return (
      <main className="min-h-screen bg-white">
        <section className="grid min-h-screen place-items-center px-6">
          <div className="w-full max-w-[720px] px-8 py-16 text-center">
            <span className="text-[0.75rem] font-bold uppercase tracking-[0.18em] text-[var(--dashboard-ink-soft)]">
              Project
            </span>
            <h1 className="m-0 text-[clamp(2rem,4vw,3.5rem)] leading-[0.98] tracking-[-0.05em] text-[var(--dashboard-ink)]">
              Not Found
            </h1>
            <p className="m-0 text-[0.9375rem] leading-[1.7] text-[var(--dashboard-ink-muted)]">
              No project matched <code>{decodedId}</code>.
            </p>
            <Link
              href="/"
              className="mx-auto mt-6 inline-flex min-h-[3.375rem] items-center justify-center gap-3 rounded-2xl border border-[rgba(0,38,27,0.12)] bg-[var(--dashboard-primary)] px-5 font-semibold text-white shadow-[0_16px_30px_rgba(0,38,27,0.24)] transition hover:-translate-y-0.5 hover:bg-[var(--dashboard-primary-container)] hover:text-white hover:shadow-[0_20px_34px_rgba(0,38,27,0.28)] [&_span]:text-white"
              style={{ color: "#f6fffa" }}
            >
              <span>Back to Dashboard</span>
            </Link>
          </div>
        </section>
      </main>
    );
  }

  if (instance && !instanceAccessible) {
    return (
      <main className="min-h-screen bg-white">
        <section className="grid min-h-screen place-items-center px-6">
          <div className="w-full max-w-[960px] px-8 py-16 text-center">
            <span className="text-[0.75rem] font-bold uppercase tracking-[0.18em] text-[var(--dashboard-ink-soft)]">
              Project
            </span>
            <h1 className="m-0 text-[clamp(2rem,4vw,3.5rem)] leading-[0.98] tracking-[-0.05em] text-[var(--dashboard-ink)]">
              Still Starting
            </h1>
            <p className="m-0 text-[0.9375rem] leading-[1.7] text-[var(--dashboard-ink-muted)]">
              This project is not ready yet. Access to the workspace stays locked until provisioning finishes.
            </p>
            <div className="mx-auto mt-6 inline-flex items-center gap-3 rounded-full border border-[rgba(0,38,27,0.08)] bg-[#f8f9f7] px-4 py-2.5 text-[0.95rem] font-bold text-[var(--dashboard-ink)]">
              <span className="inline-block size-4 animate-spin rounded-full border-2 border-[rgba(0,38,27,0.16)] border-t-[var(--dashboard-primary)]" />
              <span>{statusLabel}</span>
            </div>
            <WaitingLogsPanel instance={instance} />
            <Link
              href="/"
              className="mx-auto mt-6 inline-flex min-h-[3.375rem] items-center justify-center gap-3 rounded-2xl border border-[rgba(0,38,27,0.12)] bg-[var(--dashboard-primary)] px-5 font-semibold text-white shadow-[0_16px_30px_rgba(0,38,27,0.24)] transition hover:-translate-y-0.5 hover:bg-[var(--dashboard-primary-container)] hover:text-white hover:shadow-[0_20px_34px_rgba(0,38,27,0.28)] [&_span]:text-white"
              style={{ color: "#f6fffa" }}
            >
              <span>Back to Dashboard</span>
            </Link>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-white">
      <section className="flex min-h-screen flex-col">
        <section className="flex flex-1 flex-col items-start gap-6 xl:flex-row xl:gap-10">
          <aside
            className={`flex w-full flex-col gap-6 bg-[#f8f9f7] px-5 py-8 shadow-[inset_0_-1px_0_rgba(0,38,27,0.08)] xl:min-h-screen xl:flex-none xl:py-8 xl:shadow-[inset_-1px_0_0_rgba(0,38,27,0.08)] xl:transition-[width,padding] xl:duration-150 ${
              isSidebarCollapsed ? "xl:w-[84px] xl:px-3" : "xl:w-[300px] xl:px-7"
            }`}
          >
            <div
              className={`flex items-start gap-2 ${
                isSidebarCollapsed ? "justify-between xl:justify-center" : "justify-between"
              }`}
            >
              {!isSidebarCollapsed ? (
                <h2 className="m-0 text-[1.2rem] font-extrabold leading-[1.1] tracking-[-0.04em] text-[var(--dashboard-ink)]">
                  {projectTitle}
                </h2>
              ) : null}
              <div
                className={`flex shrink-0 items-center gap-1 ${
                  isSidebarCollapsed ? "ml-auto xl:ml-0" : "ml-auto"
                }`}
              >
                <button
                  type="button"
                  aria-label={isSidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
                  className="hidden shrink-0 rounded-full p-1.5 text-[var(--dashboard-ink-muted)] transition hover:bg-[rgba(0,38,27,0.08)] hover:text-[var(--dashboard-ink)] xl:flex"
                  onClick={() => setIsSidebarCollapsed((current) => !current)}
                >
                  {isSidebarCollapsed ? (
                    <PanelLeftOpen className="size-4" />
                  ) : (
                    <PanelLeftClose className="size-4" />
                  )}
                </button>
                {/* Below `xl` the sidebar isn't collapsible (the toggle above is
                    `xl:flex` only), so a full vertical stack of ~14 rows would push
                    the page content off-screen. Hide it behind a burger menu instead. */}
                <button
                  type="button"
                  aria-label={isMobileNavOpen ? "Close menu" : "Open menu"}
                  aria-expanded={isMobileNavOpen}
                  className="flex shrink-0 items-center justify-center rounded-full p-1.5 text-[var(--dashboard-ink-muted)] transition hover:bg-[rgba(0,38,27,0.08)] hover:text-[var(--dashboard-ink)] xl:hidden"
                  onClick={() => setIsMobileNavOpen((current) => !current)}
                >
                  {isMobileNavOpen ? <X className="size-5" /> : <Menu className="size-5" />}
                </button>
              </div>
            </div>

            {isMobileNavOpen ? (
              <nav className="grid gap-1.5 xl:hidden" aria-label="Project sections">
                <ProjectNavLinks
                  views={visibleViews}
                  projectPath={`/projects/${encodeURIComponent(decodedId)}`}
                  activeSegment={activeSegment}
                  collapsed={false}
                  onNavigate={() => setIsMobileNavOpen(false)}
                />
                <Link
                  href="/"
                  onClick={() => setIsMobileNavOpen(false)}
                  className={cn(NAV_LINK_BASE_CLASSES, navLinkActiveClasses(false))}
                >
                  <LayoutGrid />
                  <span>Projects</span>
                </Link>
              </nav>
            ) : null}

            {/* Desktop: the original full-height vertical nav, collapsible via the
                toggle above (which only renders at `xl`). */}
            <nav className="hidden xl:grid xl:gap-1.5" aria-label="Project sections">
              <ProjectNavLinks
                views={visibleViews}
                projectPath={`/projects/${encodeURIComponent(decodedId)}`}
                activeSegment={activeSegment}
                collapsed={isSidebarCollapsed}
              />
            </nav>

            <div className="mt-auto hidden pt-8 xl:block">
              <Link
                href="/"
                title={isSidebarCollapsed ? "Projects" : undefined}
                className={cn(
                  NAV_LINK_BASE_CLASSES,
                  "text-[var(--dashboard-ink-muted)] hover:bg-[rgba(220,230,224,0.65)]",
                  isSidebarCollapsed && "xl:justify-center xl:px-0",
                )}
              >
                <LayoutGrid />
                <span className={isSidebarCollapsed ? "xl:hidden" : undefined}>Projects</span>
              </Link>
            </div>
          </aside>

          <section className="grid w-full min-w-0 flex-1 content-start gap-8 px-5 pb-12 pt-8 sm:px-8 xl:px-0 xl:py-12 xl:pr-8">
            {children}
          </section>
        </section>
      </section>
    </main>
  );
}

function isInstanceAccessible(instance: InstanceRecord): boolean {
  const runtimeStatus = instance.runtimeStatus?.toLowerCase();
  const provisioningStatus = instance.status.toLowerCase();

  if (runtimeStatus === "linked") {
    return true;
  }
  if (runtimeStatus === "failed" || provisioningStatus === "failed") {
    return true;
  }
  return false;
}
