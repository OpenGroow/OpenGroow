"use client";

import Link from "next/link";
import {
  Boxes,
  Check,
  Clock,
  Copy,
  Layers,
  Loader2,
  Plus,
  Server,
  Trash2,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useAction, useQuery } from "convex/react";
import { useEffect, useRef, useState } from "react";
import { api } from "../../../convex/_generated/api.js";
import { useSession } from "@/src/lib/auth-client";
import { DashboardRootSidebar } from "@/src/components/dashboard-root-sidebar";
import { ProjectNameDialog } from "@/src/components/project-name-dialog";
import { getInstancePathId } from "@/src/lib/instance-path";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { AGENT_TONE_CLASSES } from "@/components/opengroow/agent-presentation";
import { SearchField } from "@/components/opengroow/filter-bar";
import { PageHeader } from "@/components/opengroow/page-header";
import { StatusBadge, type StatusTone } from "@/components/opengroow/status-badge";
import { relativeTime } from "@/src/lib/relative-time";

type DashboardHomeProps = {
  focusInstanceId?: string;
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
  const [createPhase, setCreatePhase] = useState<CreatePhase>("idle");
  const [createError, setCreateError] = useState<string | null>(null);
  const [createdJobId, setCreatedJobId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deletingJobId, setDeletingJobId] = useState<string | null>(null);
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [optimisticInstances, setOptimisticInstances] = useState<DashboardInstance[]>([]);
  const [locallyDeletedJobIds, setLocallyDeletedJobIds] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const locallyDeletedJobIdsRef = useRef(new Set<string>());
  const displayedInstances = [
    ...optimisticInstances.filter(
      (optimisticInstance) =>
        !instances?.some((instance) => instance.jobId === optimisticInstance.jobId),
    ),
    ...(instances ?? []),
  ].filter((instance) => !locallyDeletedJobIds.includes(instance.jobId));
  const hasInstances = displayedInstances.length > 0;

  const needle = query.trim().toLowerCase();
  const visibleInstances = displayedInstances.filter((instance) => {
    if (!needle) return true;
    return [instance.displayName, instance.openclawId, instance.jobId].some((value) =>
      value?.toLowerCase().includes(needle),
    );
  });

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

  return (
    <main className="min-h-screen w-full bg-card xl:grid xl:grid-cols-[320px_minmax(0,1fr)]">
      <DashboardRootSidebar
        activeHref="/"
        workspaceTitle={workspaceTitle}
        workspaceSubtitle={workspaceSubtitle}
      />

      <section className="grid min-w-0 content-start gap-8 px-5 pb-14 pt-8 sm:px-8 xl:px-11 xl:pb-14 xl:pt-13">
        <PageHeader
          title="Projects"
          description="Manage your OpenGroow projects."
          action={
            <div className="flex w-full flex-col gap-3 sm:flex-row sm:items-center lg:w-auto">
              <SearchField
                value={query}
                onChange={setQuery}
                label="Search projects"
                placeholder="Search projects…"
              />
              <Button
                variant="glow"
                size="lg"
                type="button"
                onClick={() => setIsCreateDialogOpen(true)}
                disabled={isCreating}
              >
                <Plus />
                New Project
              </Button>
            </div>
          }
        />

        {createPhase !== "idle" ? (
          <div
            role="status"
            className={cn(
              "inline-flex min-h-11 w-fit flex-wrap items-center gap-3 rounded-xl px-4 py-3 ring-1 ring-inset ring-border",
              createPhase === "error"
                ? "bg-destructive/10 text-destructive"
                : "bg-primary/10 text-primary",
            )}
          >
            {isCreating ? <Loader2 className="size-4 animate-spin" /> : null}
            <span>{CREATE_PHASE_LABELS[createPhase]}</span>
            {createError ? <span>{createError}</span> : null}
          </div>
        ) : null}

        {deleteError ? (
          <div className="inline-flex min-h-11 w-fit items-center rounded-xl bg-destructive/10 px-4 py-3 text-destructive ring-1 ring-inset ring-border">
            {deleteError}
          </div>
        ) : null}

        <section className="grid gap-6 md:grid-cols-2 xl:grid-cols-3" aria-label="Projects">
          {visibleInstances.map((instance, index) => {
            const visual = getInstanceVisual(instance);
            const isNavigable = isInstanceNavigable(instance);
            const isDeleting = deletingJobId === instance.jobId;
            const isFocused =
              !!focusInstanceId &&
              (instance.openclawId === focusInstanceId || instance.jobId === focusInstanceId);
            const projectId = instance.openclawId ?? instance.jobId;
            const href = `/projects/${encodeURIComponent(getInstancePathId(instance))}`;

            return (
              <Card
                key={instance._id}
                data-slot="project-card"
                className={cn(
                  "glow-hover relative cursor-pointer gap-5 px-6 py-6 transition-colors hover:bg-surface-raised has-[a:focus-visible]:ring-2 has-[a:focus-visible]:ring-ring",
                  isFocused && "ring-2 ring-primary/60",
                )}
              >
                <div className="flex items-center gap-4">
                  <span
                    aria-hidden="true"
                    className={cn(
                      "flex size-14 shrink-0 items-center justify-center rounded-xl",
                      PROJECT_TILE_TONES[index % PROJECT_TILE_TONES.length],
                    )}
                  >
                    {index % 2 === 0 ? <Boxes className="size-7" /> : <Layers className="size-7" />}
                  </span>
                  {visual ? <StatusBadge tone={visual.tone} label={visual.label} /> : null}
                  <div className="ml-auto flex items-center gap-1">
                    {!isNavigable ? (
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        type="button"
                        aria-label="Delete project"
                        className="relative z-10"
                        loading={isDeleting}
                        onClick={() => void handleDeleteInstance(instance)}
                      >
                        <Trash2 />
                      </Button>
                    ) : null}
                  </div>
                </div>

                <h2 className="m-0 text-xl font-semibold break-words text-foreground">
                  <Link
                    href={href}
                    className="outline-none after:absolute after:inset-0 after:content-['']"
                  >
                    {instance.displayName?.trim() || "Untitled Project"}
                  </Link>
                </h2>

                <ul className="m-0 grid list-none gap-3 p-0 text-sm text-muted-foreground">
                  {typeof instance.openclawServerId === "number" ? (
                    <li className="flex items-center gap-3">
                      <Server className="size-4 shrink-0" aria-hidden="true" />
                      Node {instance.openclawServerId}
                    </li>
                  ) : null}
                  <li className="flex items-center gap-3">
                    <span className="shrink-0 font-medium text-foreground">ID</span>
                    <span className="min-w-0 truncate font-mono">{projectId}</span>
                    <CopyIdButton value={projectId} />
                  </li>
                  <li className="flex items-center gap-3 tabular-nums">
                    <Clock className="size-4 shrink-0" aria-hidden="true" />
                    {formatRelativeUpdate(instance.updatedAt)}
                  </li>
                </ul>
              </Card>
            );
          })}

          {hasInstances && visibleInstances.length === 0 ? (
            <Card className="items-center justify-center px-6 py-10 text-center md:col-span-2 xl:col-span-2">
              <p className="m-0 text-base text-muted-foreground">No project matches your search.</p>
            </Card>
          ) : null}
        </section>

        <ProjectNameDialog
          mode="create"
          open={isCreateDialogOpen}
          onOpenChange={setIsCreateDialogOpen}
          onSubmit={(name) => handleCreateInstance(name)}
        />
      </section>
    </main>
  );
}

// Tiles cycle through the agent tones so neighbouring Projects stay distinguishable.
const PROJECT_TILE_TONES = [
  AGENT_TONE_CLASSES.visual,
  AGENT_TONE_CLASSES.creative,
  AGENT_TONE_CLASSES.research,
  AGENT_TONE_CLASSES.engagement,
];

function CopyIdButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard can be unavailable (insecure context); the ID stays selectable.
    }
  }

  return (
    <Button
      variant="ghost"
      size="icon-xs"
      type="button"
      aria-label={copied ? "Project ID copied" : "Copy project ID"}
      className="relative z-10 ml-auto"
      onClick={() => void copy()}
    >
      {copied ? <Check /> : <Copy />}
    </Button>
  );
}

function getInstanceVisual(instance: DashboardInstance): InstanceVisual {
  const runtimeStatus = instance.runtimeStatus?.toLowerCase();
  const provisioningStatus = instance.status.toLowerCase();

  if (runtimeStatus === "failed" || provisioningStatus === "failed") {
    return { tone: "error", label: "Issue" };
  }
  if (runtimeStatus === "linked") {
    return { tone: "active", label: "Active" };
  }
  if (runtimeStatus === "created") {
    return { tone: "neutral", label: "Created" };
  }
  if (
    runtimeStatus === "provisioning" ||
    runtimeStatus === "starting" ||
    provisioningStatus === "queued" ||
    provisioningStatus === "running"
  ) {
    return { tone: "progress", label: "Starting" };
  }
  return { tone: "neutral", label: "Standby" };
}

function isInstanceActive(instance: DashboardInstance): boolean {
  return instance.runtimeStatus?.toLowerCase() === "linked";
}

function isInstanceNavigable(instance: DashboardInstance): boolean {
  const runtimeStatus = instance.runtimeStatus?.toLowerCase();
  const provisioningStatus = instance.status.toLowerCase();

  return runtimeStatus === "linked" || runtimeStatus === "failed" || provisioningStatus === "failed";
}

function formatRelativeUpdate(value?: string): string {
  const timestamp = value ? new Date(value).getTime() : Number.NaN;
  if (Number.isNaN(timestamp)) {
    return "Updated recently";
  }
  const elapsed = relativeTime(timestamp);
  return elapsed === "just now" ? "Updated just now" : `Updated ${elapsed}`;
}
