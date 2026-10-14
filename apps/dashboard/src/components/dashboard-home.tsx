"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAction, useMutation, useQuery } from "convex/react";
import { useEffect, useRef, useState } from "react";
import { api } from "../../../convex/_generated/api.js";
import { useSession } from "@/src/lib/auth-client";
import type { BrokerHealth } from "@/src/lib/health";
import { DashboardRootSidebar } from "@/src/components/dashboard-root-sidebar";
import { ProjectNameDialog } from "@/src/components/project-name-dialog";
import { getInstancePathId } from "@/src/lib/instance-path";
import { cn } from "@/lib/utils";

type DashboardHomeProps = {
  focusInstanceId?: string;
  health: BrokerHealth;
};

type DashboardInstance = {
  _id: string;
  jobId: string;
  status: string;
  runtimeStatus?: string;
  runtimeReady?: boolean;
  runtimeStatusUpdatedAt?: string;
  runtimeStatusError?: string;
  displayName?: string;
  openclawName?: string;
  openclawId?: string;
  openclawServerId?: number;
  brokerServerId?: number;
  ipv4?: string;
  updatedAt?: string;
};

type StatusTone = "active" | "standby" | "error";

type InstanceVisual = {
  tone: StatusTone;
  label: string;
};

type CreatePhase = "idle" | "creating" | "provisioning" | "linking" | "done" | "error";

const CREATE_PHASE_LABELS: Record<CreatePhase, string> = {
  idle: "",
  creating: "Creating project…",
  provisioning: "Provisioning infrastructure…",
  linking: "Linking project…",
  done: "Project ready.",
  error: "Project creation failed.",
};

export function DashboardHome({
  focusInstanceId,
  health,
}: DashboardHomeProps) {
  const allowUnauthenticatedCreate = process.env.NODE_ENV !== "production";
  const router = useRouter();
  const { data: session } = useSession();
  const instances = useQuery(
    api.instances.list,
    session?.user ? {} : "skip"
  ) as
    | DashboardInstance[]
    | undefined;
  const createJob = useAction(api.instances_node.createJob);
  const removeInstanceFromInfra = useAction(api.instances_node.removeInstance);
  const renameInstance = useMutation(api.instances.renameInstance);
  const [createPhase, setCreatePhase] = useState<CreatePhase>("idle");
  const [createError, setCreateError] = useState<string | null>(null);
  const [createdJobId, setCreatedJobId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deletingJobId, setDeletingJobId] = useState<string | null>(null);
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<DashboardInstance | null>(null);
  const [optimisticInstances, setOptimisticInstances] = useState<DashboardInstance[]>([]);
  const [locallyDeletedJobIds, setLocallyDeletedJobIds] = useState<string[]>([]);
  const locallyDeletedJobIdsRef = useRef(new Set<string>());
  const displayedInstances = [
    ...optimisticInstances.filter(
      (optimisticInstance) =>
        !instances?.some((instance) => instance.jobId === optimisticInstance.jobId),
    ),
    ...(instances ?? []),
  ].filter((instance) => !locallyDeletedJobIds.includes(instance.jobId));
  const hasInstances = displayedInstances.length > 0;

  const activeCount = displayedInstances.filter(isInstanceActive).length;
  const onlineCount =
    displayedInstances.filter(
      (instance) => typeof instance.ipv4 === "string" && instance.ipv4.length > 0,
    ).length;
  const systemStatus = health.ok && health.convex?.ok !== false ? "Optimal" : "Attention";
  const workspaceTitle = session?.user?.name?.trim() || "OpenClaw Control";
  const workspaceSubtitle =
    session?.user?.email?.trim() || "Managed operator runtime";
  const isCreating =
    createPhase !== "idle" && createPhase !== "done" && createPhase !== "error";

  useEffect(() => {
    if (!instances?.length) {
      return;
    }
    setOptimisticInstances((current) =>
      current.filter(
        (optimisticInstance) =>
          !instances.some((instance) => instance.jobId === optimisticInstance.jobId),
      ),
    );
  }, [instances]);

  useEffect(() => {
    if (!createdJobId || !instances?.length) {
      return;
    }

    const instance = instances.find((item) => item.jobId === createdJobId);
    if (!instance) {
      return;
    }

    const runtimeStatus = instance.runtimeStatus?.toLowerCase();
    const provisioningStatus = instance.status.toLowerCase();

    if (runtimeStatus === "failed" || provisioningStatus === "failed") {
      setCreatePhase("error");
      setCreateError(instance.runtimeStatusError ?? "Project creation failed");
      setCreatedJobId(null);
      return;
    }
    if (runtimeStatus === "linked" && instance.openclawId) {
      setCreatePhase("done");
      setCreatedJobId(null);
      router.push(`/projects/${encodeURIComponent(instance.openclawId)}`);
      router.refresh();
      return;
    }
    if (instance.openclawId) {
      setCreatePhase("linking");
      return;
    }
    setCreatePhase("provisioning");
  }, [createdJobId, instances, router]);

  async function handleCreateInstance(displayName: string): Promise<void> {
    if (isCreating) {
      return;
    }

    if (!allowUnauthenticatedCreate && !session?.user) {
      setCreatePhase("error");
      setCreateError("You must be signed in before creating a Project.");
      return;
    }

    setCreateError(null);
    setCreatePhase("creating");

    try {
      const jobResult = await createJob({ displayName });
      if (!jobResult.job) {
        throw new Error(jobResult.error ?? "Failed to create Project");
      }

      const createdJob = jobResult.job;
      const jobId = createdJob.id;
      setCreatedJobId(jobId);
      setOptimisticInstances((current) => [
        {
          _id: `optimistic-${jobId}`,
          jobId,
          status: createdJob.status,
          runtimeStatus: createdJob.runtimeStatus,
          runtimeReady: createdJob.runtimeReady,
          runtimeStatusUpdatedAt: createdJob.runtimeStatusUpdatedAt,
          runtimeStatusError: createdJob.runtimeStatusError,
          updatedAt: createdJob.createdAt,
          displayName,
        },
        ...current.filter((instance) => instance.jobId !== jobId),
      ]);
      setCreatePhase("provisioning");
    } catch (error: unknown) {
      setCreatedJobId(null);
      setOptimisticInstances((current) =>
        current.filter((instance) => !instance._id.startsWith("optimistic-")),
      );
      setCreatePhase("error");
      setCreateError(error instanceof Error ? error.message : "Project creation failed");
    }
  }

  async function handleDeleteInstance(instance: DashboardInstance): Promise<void> {
    if (deletingJobId) {
      return;
    }

    const confirmed = window.confirm(
      "Delete this project and remove it from the dashboard?",
    );
    if (!confirmed) {
      return;
    }

    setDeleteError(null);
    setDeletingJobId(instance.jobId);
    locallyDeletedJobIdsRef.current.add(instance.jobId);
    setLocallyDeletedJobIds((current) =>
      current.includes(instance.jobId) ? current : [...current, instance.jobId],
    );

    try {
      const data = await removeInstanceFromInfra({ jobId: instance.jobId });

      if ("error" in data) {
        throw new Error(data.error);
      }
      if (data.ok !== true) {
        throw new Error("Project deletion failed");
      }

      setOptimisticInstances((current) =>
        current.filter((item) => item.jobId !== instance.jobId),
      );
      router.refresh();
    } catch (error: unknown) {
      locallyDeletedJobIdsRef.current.delete(instance.jobId);
      setLocallyDeletedJobIds((current) =>
        current.filter((jobId) => jobId !== instance.jobId),
      );
      setDeleteError(
        error instanceof Error ? error.message : "Failed to delete Project",
      );
    } finally {
      setDeletingJobId(null);
    }
  }

  async function handleRenameInstance(instance: DashboardInstance, name: string): Promise<void> {
    await renameInstance({ jobId: instance.jobId, displayName: name });
  }

  return (
    <main className="min-h-screen w-full bg-white xl:grid xl:grid-cols-[320px_minmax(0,1fr)]">
      <DashboardRootSidebar
        activeHref="/"
        workspaceTitle={workspaceTitle}
        workspaceSubtitle={workspaceSubtitle}
      />

      <section className="grid min-w-0 content-start gap-0 px-5 pb-14 pt-8 sm:px-8 xl:px-11 xl:pb-14 xl:pt-[var(--dashboard-home-top-offset)]">
        <header className="flex flex-col items-start justify-between gap-6 lg:flex-row lg:items-center">
          <div className="grid gap-1.5">
            <h1 className="m-0 text-[clamp(2.4rem,5vw,4rem)] leading-[0.98] tracking-[-0.06em] text-[var(--dashboard-primary)]">
              Projects
            </h1>
            <p className="m-0 text-[1.125rem] text-[var(--dashboard-ink-muted)]">
              Manage your OpenClaw compute environments.
            </p>
          </div>

        </header>

        {createPhase !== "idle" ? (
          <div
            className={cn(
              "mt-5 inline-flex min-h-11 flex-wrap items-center gap-3 rounded-2xl px-4 py-3 shadow-[inset_0_0_0_1px_rgba(0,38,27,0.08)]",
              createPhase === "error"
                ? "bg-[rgba(84,41,37,0.08)] text-[var(--dashboard-tertiary)]"
                : "bg-[rgba(188,237,215,0.35)] text-[var(--dashboard-primary)]",
            )}
          >
            <span>{CREATE_PHASE_LABELS[createPhase]}</span>
            {createError ? <span>{createError}</span> : null}
          </div>
        ) : null}

        {deleteError ? (
          <div className="mt-4 inline-flex min-h-11 items-center rounded-2xl bg-[rgba(84,41,37,0.08)] px-4 py-3 text-[var(--dashboard-tertiary)] shadow-[inset_0_0_0_1px_rgba(84,41,37,0.08)]">
            {deleteError}
          </div>
        ) : null}

        <section
          className={cn(
            "mt-11 grid gap-6",
            hasInstances
              ? "md:grid-cols-2 xl:grid-cols-3"
              : "[grid-template-columns:minmax(320px,360px)]",
          )}
          aria-label="Projects"
        >
          {displayedInstances.map((instance, index) => {
            const visual = getInstanceVisual(instance);
            const isNavigable = isInstanceNavigable(instance);
            const canDeleteFromCard = !isNavigable;
            const isDeleting = deletingJobId === instance.jobId;
            const isFocused =
              !!focusInstanceId &&
              (instance.openclawId === focusInstanceId ||
                instance.jobId === focusInstanceId);

            return (
              <article
                key={instance._id}
                className={cn(
                  "relative flex min-h-[23rem] flex-col gap-7 overflow-hidden rounded-[1.9rem] bg-[linear-gradient(180deg,rgba(255,255,255,0.96),rgba(244,246,245,0.86))] p-7 shadow-[var(--dashboard-shadow)] transition-[transform,box-shadow,background-color] duration-180 hover:-translate-y-0.5 hover:shadow-[0_22px_44px_rgba(25,28,28,0.08)]",
                  isFocused
                    ? "shadow-[0_22px_44px_rgba(25,28,28,0.08),inset_0_0_0_1px_rgba(0,38,27,0.18)]"
                    : "",
                )}
              >
                <div className="flex min-h-8 justify-end">
                  {visual ? (
                    <span
                      className={cn(
                        "inline-flex min-h-8 items-center justify-center rounded-full px-3.5 py-1 text-[0.8125rem] font-bold uppercase tracking-[0.12em]",
                        getStatusBadgeClass(visual.tone),
                      )}
                    >
                      {visual.label}
                    </span>
                  ) : null}
                </div>

                <div className="grid min-h-[6.5rem] gap-3.5">
                  <div className="flex items-start justify-between gap-3">
                    <h2 className="m-0 font-[var(--font-dashboard-display)] text-[clamp(1.55rem,2vw,2rem)] leading-[1.08] tracking-[-0.05em] text-[var(--dashboard-ink)] break-words">
                      {instance.displayName?.trim() || "Untitled Project"}
                    </h2>
                    <button
                      type="button"
                      aria-label="Rename project"
                      className="shrink-0 rounded-full p-2 text-[var(--dashboard-ink-muted)] transition hover:bg-[rgba(0,38,27,0.06)] hover:text-[var(--dashboard-ink)]"
                      onClick={() => setRenameTarget(instance)}
                    >
                      <PencilIcon />
                    </button>
                  </div>
                  <p className="m-0 text-[0.95rem] leading-7 text-[var(--dashboard-ink-muted)]">
                    {formatInstanceMeta(instance)}
                  </p>
                </div>

                <div className="mt-auto flex items-center justify-between gap-4 pt-5 shadow-[inset_0_1px_0_rgba(192,200,195,0.24)]">
                  <span className="m-0 text-[0.95rem] leading-7 text-[var(--dashboard-ink-muted)]">
                    {formatRelativeUpdate(instance.updatedAt)}
                  </span>
                  <div className="flex flex-wrap items-center justify-end gap-3">
                    {canDeleteFromCard ? (
                      <button
                        type="button"
                        className="inline-flex min-h-9 items-center rounded-full bg-[rgba(126,61,53,0.08)] px-3.5 text-[0.8125rem] font-bold uppercase tracking-[0.11em] text-[#7e3d35] transition hover:bg-[rgba(126,61,53,0.14)] disabled:cursor-wait disabled:opacity-60"
                        onClick={() => void handleDeleteInstance(instance)}
                        disabled={isDeleting}
                      >
                        {isDeleting ? "Deleting…" : "Delete"}
                      </button>
                    ) : null}
                    <Link
                      href={`/projects/${encodeURIComponent(getInstancePathId(instance))}`}
                      className={cn(
                        "inline-flex items-center gap-2 font-bold [&_svg]:size-5",
                        isNavigable
                          ? "text-[var(--dashboard-primary)]"
                          : "text-[var(--dashboard-primary)]",
                      )}
                    >
                      {isNavigable ? (
                        <span>Enter</span>
                      ) : (
                        <>
                          <SpinnerIcon />
                          <span>View progress…</span>
                        </>
                      )}
                      <ArrowRightIcon />
                    </Link>
                  </div>
                </div>
              </article>
            );
          })}

          <button
            type="button"
            className={cn(
              "flex w-full flex-col items-center justify-center rounded-[1.9rem] border-2 border-dashed border-[rgba(0,38,27,0.18)] bg-white/80 p-7 text-center appearance-none transition disabled:cursor-wait disabled:opacity-80",
              hasInstances ? "min-h-[23rem]" : "min-h-[24rem]",
            )}
            onClick={() => setIsCreateDialogOpen(true)}
            disabled={isCreating}
          >
            <div className="grid max-w-56 place-items-center gap-4">
              <div className="flex size-[4.875rem] items-center justify-center rounded-full bg-[rgba(25,28,28,0.08)] text-[var(--dashboard-ink)] [&_svg]:size-5">
                <PlusIcon />
              </div>
              <div className="font-[var(--font-dashboard-display)] text-[1.55rem] leading-[1.1] tracking-[-0.04em] text-[var(--dashboard-ink)]">
                {isCreating ? "Creating Project" : "Create New Project"}
              </div>
              <div className="m-0 text-[0.95rem] leading-7 text-[var(--dashboard-ink-muted)]">
                {isCreating
                  ? CREATE_PHASE_LABELS[createPhase]
                  : "Provision a new project environment."}
              </div>
            </div>
          </button>
        </section>

        <ProjectNameDialog
          mode="create"
          open={isCreateDialogOpen}
          onOpenChange={setIsCreateDialogOpen}
          onSubmit={(name) => handleCreateInstance(name)}
        />

        <ProjectNameDialog
          mode="rename"
          open={!!renameTarget}
          onOpenChange={(next) => {
            if (!next) setRenameTarget(null);
          }}
          initialName={renameTarget?.displayName}
          onSubmit={(name) => {
            if (!renameTarget) return;
            return handleRenameInstance(renameTarget, name);
          }}
        />

        {hasInstances ? (
          <footer className="mt-24 grid items-end gap-6 border-t border-[rgba(192,200,195,0.24)] pt-8 pb-4 md:grid-cols-2 xl:grid-cols-[minmax(220px,1.6fr)_repeat(4,minmax(110px,1fr))]">
            <div>
              <div className="font-[var(--font-dashboard-display)] text-[1.75rem] leading-[1.05] tracking-[-0.05em] text-[var(--dashboard-ink)]">
                OpenClaw Runtime
              </div>
              <div className="mt-1.5 text-[var(--dashboard-ink-soft)] italic">
                Architectural integrity by design.
              </div>
            </div>

            <div className="grid gap-2.5">
              <div className="text-[0.8rem] font-bold uppercase tracking-[0.16em] text-[var(--dashboard-ink-soft)]">
                Total Projects
              </div>
              <div className="font-[var(--font-dashboard-display)] text-[1.85rem] leading-none tracking-[-0.05em] text-[var(--dashboard-ink)]">
                {displayedInstances.length}
              </div>
            </div>

            <div className="grid gap-2.5">
              <div className="text-[0.8rem] font-bold uppercase tracking-[0.16em] text-[var(--dashboard-ink-soft)]">
                Active Nodes
              </div>
              <div className="font-[var(--font-dashboard-display)] text-[1.85rem] leading-none tracking-[-0.05em] text-[var(--dashboard-ink)]">
                {activeCount}
              </div>
            </div>

            <div className="grid gap-2.5">
              <div className="text-[0.8rem] font-bold uppercase tracking-[0.16em] text-[var(--dashboard-ink-soft)]">
                Reachable IPs
              </div>
              <div className="font-[var(--font-dashboard-display)] text-[1.85rem] leading-none tracking-[-0.05em] text-[var(--dashboard-ink)]">
                {onlineCount}
              </div>
            </div>

            <div className="grid gap-2.5">
              <div className="text-[0.8rem] font-bold uppercase tracking-[0.16em] text-[var(--dashboard-ink-soft)]">
                System Status
              </div>
              <div className="flex items-center gap-3 font-[var(--font-dashboard-display)] text-[1.85rem] leading-none tracking-[-0.05em] text-[var(--dashboard-ink)]">
                <span
                  className={cn(
                    "size-[0.7rem] rounded-full",
                    systemStatus === "Optimal"
                      ? "bg-[#2d7a57]"
                      : "bg-[var(--dashboard-tertiary)]",
                  )}
                />
                <span>{systemStatus}</span>
              </div>
            </div>
          </footer>
        ) : null}

      </section>
    </main>
  );
}

function getInstanceVisual(instance: DashboardInstance): InstanceVisual | null {
  const runtimeStatus = instance.runtimeStatus?.toLowerCase();
  const provisioningStatus = instance.status.toLowerCase();

  if (runtimeStatus === "failed" || provisioningStatus === "failed") {
    return { tone: "error", label: "Issue" };
  }
  if (runtimeStatus === "linked") {
    return null;
  }
  if (runtimeStatus === "created") {
    return { tone: "standby", label: "Created" };
  }
  if (
    runtimeStatus === "provisioning" ||
    runtimeStatus === "starting" ||
    provisioningStatus === "queued" ||
    provisioningStatus === "running"
  ) {
    return { tone: "standby", label: "Starting" };
  }
  return { tone: "standby", label: "Standby" };
}

function isInstanceActive(instance: DashboardInstance): boolean {
  return instance.runtimeStatus?.toLowerCase() === "linked";
}

function formatInstanceMeta(instance: DashboardInstance): string {
  const segments = [];

  if (typeof instance.openclawServerId === "number") {
    segments.push(`Node ${instance.openclawServerId}`);
  }

  if (instance.ipv4) {
    segments.push(instance.ipv4);
  }

  segments.push(
    instance.openclawId ? `ID ${instance.openclawId}` : `Job ${instance.jobId.slice(0, 8)}`,
  );

  return segments.join(" • ");
}

function isInstanceNavigable(instance: DashboardInstance): boolean {
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

function formatRelativeUpdate(value?: string): string {
  if (!value) {
    return "Updated recently";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Updated recently";
  }

  const diffMs = Date.now() - date.getTime();
  const diffMinutes = Math.max(0, Math.round(diffMs / 60000));

  if (diffMinutes < 1) {
    return "Updated just now";
  }
  if (diffMinutes < 60) {
    return `Updated ${diffMinutes}m ago`;
  }

  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) {
    return `Updated ${diffHours}h ago`;
  }

  const diffDays = Math.round(diffHours / 24);
  return `Updated ${diffDays}d ago`;
}

function getInstanceTileClass(tone: StatusTone): string {
  if (tone === "active") {
    return "bg-[linear-gradient(135deg,var(--dashboard-primary),var(--dashboard-primary-container))] text-[var(--dashboard-on-primary-container)]";
  }
  if (tone === "error") {
    return "bg-[rgba(84,41,37,0.16)] text-[var(--dashboard-tertiary)]";
  }
  return "bg-[rgba(214,219,223,0.75)] text-[rgba(25,28,28,0.7)]";
}

function getStatusBadgeClass(tone: StatusTone): string {
  if (tone === "active") {
    return "bg-[rgba(188,237,215,0.9)] text-[var(--dashboard-primary)]";
  }
  if (tone === "error") {
    return "bg-[rgba(84,41,37,0.12)] text-[var(--dashboard-tertiary)]";
  }
  return "bg-[rgba(227,230,231,0.95)] text-[var(--dashboard-ink-muted)]";
}

function SpinnerIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="size-5 animate-spin">
      <circle
        cx="12"
        cy="12"
        r="9"
        fill="none"
        stroke="currentColor"
        strokeOpacity="0.22"
        strokeWidth="2"
      />
      <path
        d="M12 3a9 9 0 0 1 9 9"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M12 5v14M5 12h14"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
      />
    </svg>
  );
}

function PencilIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="size-[1.1rem]">
      <path
        d="M4 20l1.1-4.4L15.6 5.1a1.5 1.5 0 0 1 2.12 0l1.18 1.18a1.5 1.5 0 0 1 0 2.12L8.4 18.9 4 20Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ArrowRightIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M5 12h13M13 6l6 6-6 6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function InstanceGlyph({ index }: { index: number }) {
  const glyphs = [BuildingGlyph, ScopeGlyph, ClusterGlyph, CompassGlyph];
  const Glyph = glyphs[index % glyphs.length] ?? BuildingGlyph;
  return <Glyph />;
}

function BuildingGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M6 19.5h12M8 19.5V7.5h8v12M11 10.5h2M11 13.5h2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.55"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ScopeGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M8 18.5h8M12 18.5v-3M8.5 6.5a3.5 3.5 0 1 0 7 0 3.5 3.5 0 0 0-7 0Zm1.5 9a5 5 0 0 1 0-10M14 15.5a5 5 0 0 0 0-10"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.45"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ClusterGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="4.5" y="9" width="5" height="5" rx="1.2" fill="currentColor" />
      <rect x="14.5" y="4.5" width="5" height="5" rx="1.2" fill="currentColor" opacity="0.8" />
      <rect x="14.5" y="14.5" width="5" height="5" rx="1.2" fill="currentColor" opacity="0.6" />
      <path
        d="M9.5 11.5h5m0 0V9.5m0 2v3"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
    </svg>
  );
}

function CompassGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M12 20a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm2.6-11.6-1.9 5-5 1.9 1.9-5 5-1.9Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.45"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
