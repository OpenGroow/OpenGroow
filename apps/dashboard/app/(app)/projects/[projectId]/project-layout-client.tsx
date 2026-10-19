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
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { WaitingLogsPanel } from "./waiting-logs-panel";

const NAV_LINK_BASE_CLASSES =
  "relative flex h-10 items-center gap-3 rounded-lg px-3 text-left text-base font-medium transition-colors [&_svg]:size-5 [&_svg]:shrink-0";

function navLinkActiveClasses(isActive: boolean) {
  return isActive
    ? "bg-sidebar-accent text-sidebar-accent-foreground before:absolute before:inset-y-2 before:left-0 before:w-0.5 before:rounded-full before:bg-sidebar-primary"
    : "text-sidebar-foreground/70 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground";
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
      <main className="min-h-screen bg-background">
        <section className="grid min-h-screen place-items-center px-6">
          <div className="w-full max-w-[720px] px-8 py-16 text-center text-muted-foreground">
            Loading project workspace…
          </div>
        </section>
      </main>
    );
  }

  if (instances && !instance) {
    return (
      <main className="min-h-screen bg-background">
        <section className="grid min-h-screen place-items-center px-6">
          <div className="w-full max-w-[720px] px-8 py-16 text-center">
            <span className="text-xs font-medium text-muted-foreground">
              Project
            </span>
            <h1 className="m-0 text-3xl font-semibold tracking-tight text-foreground">
              Not Found
            </h1>
            <p className="m-0 mt-2 text-sm leading-6 text-muted-foreground">
              No project matched <code>{decodedId}</code>.
            </p>
            <Link
              href="/"
              className={cn(buttonVariants({ size: "lg" }), "mt-6")}
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
      <main className="min-h-screen bg-background">
        <section className="grid min-h-screen place-items-center px-6">
          <div className="w-full max-w-[960px] px-8 py-16 text-center">
            <span className="text-xs font-medium text-muted-foreground">
              Project
            </span>
            <h1 className="m-0 text-3xl font-semibold tracking-tight text-foreground">
              Still Starting
            </h1>
            <p className="m-0 mt-2 text-sm leading-6 text-muted-foreground">
              This project is not ready yet. Access to the workspace stays locked until provisioning finishes.
            </p>
            <div className="mx-auto mt-6 inline-flex items-center gap-3 rounded-full border border-border bg-card px-4 py-2 text-sm font-medium text-foreground">
              <span className="inline-block size-4 animate-spin rounded-full border-2 border-border border-t-primary" />
              <span>{statusLabel}</span>
            </div>
            <WaitingLogsPanel instance={instance} />
            <Link
              href="/"
              className={cn(buttonVariants({ size: "lg" }), "mt-6")}
            >
              <span>Back to Dashboard</span>
            </Link>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-background">
      <section className="flex min-h-screen flex-col">
        <section className="flex flex-1 flex-col items-start gap-6 xl:flex-row xl:gap-8">
          <aside
            className={`flex w-full flex-col gap-6 border-b border-sidebar-border bg-sidebar px-5 py-6 text-sidebar-foreground xl:min-h-screen xl:flex-none xl:border-r xl:border-b-0 xl:py-6 xl:transition-[width,padding] xl:duration-150 ${
              isSidebarCollapsed ? "xl:w-16 xl:px-3" : "xl:w-72 xl:px-4"
            }`}
          >
            <div
              className={`flex items-start gap-2 ${
                isSidebarCollapsed ? "justify-between xl:justify-center" : "justify-between"
              }`}
            >
              {!isSidebarCollapsed ? (
                <h2 className="m-0 truncate text-lg font-semibold tracking-tight text-sidebar-foreground">
                  {projectTitle}
                </h2>
              ) : null}
              <div
                className={`flex shrink-0 items-center gap-1 ${
                  isSidebarCollapsed ? "ml-auto xl:ml-0" : "ml-auto"
                }`}
              >
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={isSidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
                  className="hidden xl:inline-flex"
                  onClick={() => setIsSidebarCollapsed((current) => !current)}
                >
                  {isSidebarCollapsed ? (
                    <PanelLeftOpen className="size-4" />
                  ) : (
                    <PanelLeftClose className="size-4" />
                  )}
                </Button>
                {/* Below `xl` the sidebar isn't collapsible (the toggle above is
                    `xl:flex` only), so a full vertical stack of ~14 rows would push
                    the page content off-screen. Hide it behind a burger menu instead. */}
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={isMobileNavOpen ? "Close menu" : "Open menu"}
                  aria-expanded={isMobileNavOpen}
                  className="xl:hidden"
                  onClick={() => setIsMobileNavOpen((current) => !current)}
                >
                  {isMobileNavOpen ? <X /> : <Menu />}
                </Button>
              </div>
            </div>

            {isMobileNavOpen ? (
              <nav className="grid gap-1 xl:hidden" aria-label="Project sections">
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
            <nav className="hidden xl:grid xl:gap-1" aria-label="Project sections">
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
                  "text-sidebar-foreground/70 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
                  isSidebarCollapsed && "xl:justify-center xl:px-0",
                )}
              >
                <LayoutGrid />
                <span className={isSidebarCollapsed ? "xl:hidden" : undefined}>Projects</span>
              </Link>
            </div>
          </aside>

          <section className="relative isolate grid w-full min-w-0 flex-1 content-start gap-8 px-5 pb-12 pt-8 sm:px-8 xl:px-0 xl:py-10 xl:pr-8">
            {/* Spotlight behind the page header (DESIGN.md: glow-hero), faint and
                fading downwards; the pages themselves draw no background. */}
            <div
              aria-hidden="true"
              className="glow-hero pointer-events-none absolute inset-x-0 top-0 -z-10 h-96 [mask-image:linear-gradient(to_bottom,black_30%,transparent)]"
            />
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
