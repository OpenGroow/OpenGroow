"use client";

import { useState } from "react";
import { useAction } from "convex/react";
import { useSession } from "@/src/lib/auth-client";
import { api } from "@convex/_generated/api";
import { DashboardRootSidebar } from "@/src/components/dashboard-root-sidebar";
import { useAuthenticatedInstances } from "@/src/hooks/use-authenticated-instances";
import { cn } from "@/lib/utils";

type AdminInstanceRecord = {
  _id: string;
  ipv4?: string;
  openclawId?: string;
  openclawName?: string;
  runtimeStatus?: string;
  status: string;
};

type RolloutResponse = {
  accepted?: boolean;
  error?: string;
  job?: {
    id?: string;
    status?: string;
    createdAt?: string;
  };
  status?: number;
};

export function AdminPage() {
  const { data: session } = useSession();
  const rollout = useAction(api.instances_node.rollout);
  const instances = useAuthenticatedInstances<AdminInstanceRecord>();
  const [openClawImageRef, setOpenClawImageRef] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<RolloutResponse | null>(null);

  const workspaceTitle = session?.user?.name?.trim() || "OpenClaw Control";
  const workspaceSubtitle =
    session?.user?.email?.trim() || "Managed operator runtime";

  const rolloutTargets =
    instances?.filter((instance) => typeof instance.ipv4 === "string" && instance.ipv4.length > 0)
      .length ?? 0;
  const linkedInstances =
    instances?.filter((instance) => instance.runtimeStatus?.toLowerCase() === "linked")
      .length ?? 0;

  async function handleRollout(): Promise<void> {
    if (submitting || rolloutTargets === 0) {
      return;
    }

    setSubmitting(true);
    setError(null);
    setResult(null);

    try {
      const data = (await rollout({
        openClawImageRef: openClawImageRef.trim() || undefined,
      })) as RolloutResponse;

      if (data.error) {
        setError(data.error);
        return;
      }

      setResult(data);
    } catch (rolloutError: unknown) {
      setError(
        rolloutError instanceof Error
          ? rolloutError.message
          : "Image rollout failed",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="min-h-screen w-full bg-white xl:grid xl:grid-cols-[320px_minmax(0,1fr)]">
      <DashboardRootSidebar
        activeHref="/admin"
        workspaceTitle={workspaceTitle}
        workspaceSubtitle={workspaceSubtitle}
      />

      <section className="grid min-w-0 content-start gap-0 px-5 pb-14 pt-8 sm:px-8 xl:px-11 xl:pb-14 xl:pt-[var(--dashboard-home-top-offset)]">
        <header className="flex flex-col items-start justify-between gap-6 lg:flex-row lg:items-center">
          <div className="grid gap-1.5">
            <h1 className="m-0 text-[clamp(2.4rem,5vw,4rem)] leading-[0.98] tracking-[-0.06em] text-[var(--dashboard-primary)]">
              Admin
            </h1>
            <p className="m-0 text-[1.125rem] text-[var(--dashboard-ink-muted)]">
              Run operator-only actions across the fleet.
            </p>
          </div>
        </header>

        <section className="mt-11 grid gap-6 xl:max-w-[960px] xl:grid-cols-[minmax(0,1.5fr)_minmax(280px,0.8fr)]">
          <article className="grid gap-6 rounded-[1.9rem] bg-[linear-gradient(180deg,rgba(255,255,255,0.96),rgba(244,246,245,0.86))] p-7 shadow-[var(--dashboard-shadow)]">
            <div className="grid gap-2">
              <span className="text-[0.8rem] font-bold uppercase tracking-[0.16em] text-[var(--dashboard-ink-soft)]">
                Fleet Rollout
              </span>
              <h2 className="m-0 font-[var(--font-dashboard-display)] text-[2rem] leading-[1.02] tracking-[-0.05em] text-[var(--dashboard-ink)]">
                Update all runtimes to the latest images
              </h2>
              <p className="m-0 max-w-2xl text-[0.98rem] leading-7 text-[var(--dashboard-ink-muted)]">
                This uses the image-only rollout path. It pulls the configured gateway and runtime-worker images,
                then restarts the containers on every reachable runtime. It does not run the heavier compose refresh/bootstrap flow.
              </p>
            </div>

            <label className="grid gap-2">
              <span className="text-[0.85rem] font-semibold text-[var(--dashboard-ink)]">
                Gateway image override
              </span>
              <input
                type="text"
                value={openClawImageRef}
                onChange={(event) => setOpenClawImageRef(event.target.value)}
                placeholder="Optional: ghcr.io/org/openclaw-gateway:tag"
                className="min-h-12 rounded-2xl border border-[rgba(0,38,27,0.12)] bg-white px-4 text-[0.95rem] text-[var(--dashboard-ink)] outline-none transition focus:border-[rgba(0,38,27,0.24)]"
              />
              <span className="text-[0.85rem] leading-6 text-[var(--dashboard-ink-soft)]">
                Leave blank to use the control service runtime defaults.
              </span>
            </label>

            <div className="flex flex-wrap items-center gap-4">
              <button
                type="button"
                onClick={() => void handleRollout()}
                disabled={submitting || rolloutTargets === 0}
                className="inline-flex min-h-12 items-center justify-center rounded-2xl bg-[var(--dashboard-primary)] px-5 font-semibold text-[var(--dashboard-on-primary)] shadow-[0_16px_30px_rgba(0,38,27,0.24)] transition hover:-translate-y-0.5 hover:bg-[var(--dashboard-primary-container)] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {submitting ? "Starting rollout…" : "Roll out new images"}
              </button>

              <span className="text-[0.92rem] text-[var(--dashboard-ink-muted)]">
                Targets {rolloutTargets} instance{rolloutTargets === 1 ? "" : "s"}
              </span>
            </div>

            {result?.accepted && result.job?.id ? (
              <div className="rounded-2xl bg-[rgba(188,237,215,0.35)] px-4 py-3 text-[0.95rem] text-[var(--dashboard-primary)] shadow-[inset_0_0_0_1px_rgba(0,38,27,0.08)]">
                Rollout accepted. Job <strong>{result.job.id}</strong> is {result.job.status ?? "queued"}.
              </div>
            ) : null}

            {error ? (
              <div className="rounded-2xl bg-[rgba(84,41,37,0.08)] px-4 py-3 text-[0.95rem] text-[var(--dashboard-tertiary)] shadow-[inset_0_0_0_1px_rgba(84,41,37,0.08)]">
                {error}
              </div>
            ) : null}
          </article>

          <aside className="grid gap-4 rounded-[1.9rem] bg-[#fbfcfa] p-6 shadow-[inset_0_0_0_1px_rgba(0,38,27,0.08)]">
            <MetricCard label="Reachable runtimes" value={String(rolloutTargets)} />
            <MetricCard label="Linked runtimes" value={String(linkedInstances)} />
            <MetricCard
              label="Rollout mode"
              value="Image only"
              tone="accent"
            />
          </aside>
        </section>
      </section>
    </main>
  );
}

function MetricCard({
  label,
  tone = "default",
  value,
}: {
  label: string;
  tone?: "default" | "accent";
  value: string;
}) {
  return (
    <div
      className={cn(
        "grid gap-2 rounded-[1.4rem] px-4 py-4",
        tone === "accent"
          ? "bg-[linear-gradient(135deg,rgba(188,237,215,0.92),rgba(214,236,226,0.88))]"
          : "bg-white",
      )}
    >
      <span className="text-[0.78rem] font-bold uppercase tracking-[0.16em] text-[var(--dashboard-ink-soft)]">
        {label}
      </span>
      <span className="font-[var(--font-dashboard-display)] text-[1.7rem] leading-none tracking-[-0.05em] text-[var(--dashboard-ink)]">
        {value}
      </span>
    </div>
  );
}
