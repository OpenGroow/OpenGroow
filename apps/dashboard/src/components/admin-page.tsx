"use client";

import { useState } from "react";
import { useAction } from "convex/react";
import { useSession } from "@/src/lib/auth-client";
import { api } from "@convex/_generated/api";
import { DashboardRootSidebar } from "@/src/components/dashboard-root-sidebar";
import { useAuthenticatedInstances } from "@/src/hooks/use-authenticated-instances";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/opengroow/page-header";
import { Card } from "@/components/ui/card";

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
    <main className="min-h-screen w-full bg-card xl:grid xl:grid-cols-[320px_minmax(0,1fr)]">
      <DashboardRootSidebar
        activeHref="/admin"
        workspaceTitle={workspaceTitle}
        workspaceSubtitle={workspaceSubtitle}
      />

      <section className="grid min-w-0 content-start gap-0 px-5 pb-14 pt-8 sm:px-8 xl:px-11 xl:pb-14 xl:pt-13">
        <PageHeader title="Admin" description="Run operator-only actions across the fleet." />

        <section className="mt-11 grid gap-6 xl:max-w-[960px] xl:grid-cols-[minmax(0,1.5fr)_minmax(280px,0.8fr)]">
          <Card className="grid gap-6 p-7">
            <div className="grid gap-2">
              <span className="text-xs font-semibold text-muted-foreground">
                Fleet Rollout
              </span>
              <h2 className="m-0 text-xl font-semibold text-foreground">
                Update all runtimes to the latest images
              </h2>
              <p className="m-0 max-w-2xl text-base leading-7 text-muted-foreground">
                This uses the image-only rollout path. It pulls the configured gateway and runtime-worker images,
                then restarts the containers on every reachable runtime. It does not run the heavier compose refresh/bootstrap flow.
              </p>
            </div>

            <label className="grid gap-2">
              <span className="text-sm font-semibold text-foreground">
                Gateway image override
              </span>
              <Input
                type="text"
                value={openClawImageRef}
                onChange={(event) => setOpenClawImageRef(event.target.value)}
                placeholder="Optional: ghcr.io/org/openclaw-gateway:tag"
              />
              <span className="text-sm leading-6 text-muted-foreground">
                Leave blank to use the control service runtime defaults.
              </span>
            </label>

            <div className="flex flex-wrap items-center gap-4">
              <Button
                size="lg"
                type="button"
                onClick={() => void handleRollout()}
                disabled={submitting || rolloutTargets === 0}
              >
                {submitting ? "Starting rollout…" : "Roll out new images"}
              </Button>

              <span className="text-sm text-muted-foreground">
                Targets {rolloutTargets} instance{rolloutTargets === 1 ? "" : "s"}
              </span>
            </div>

            {result?.accepted && result.job?.id ? (
              <div className="rounded-xl bg-primary/10 px-4 py-3 text-sm text-primary ring-1 ring-inset ring-border">
                Rollout accepted. Job <strong>{result.job.id}</strong> is {result.job.status ?? "queued"}.
              </div>
            ) : null}

            {error ? (
              <div className="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive ring-1 ring-inset ring-border">
                {error}
              </div>
            ) : null}
          </Card>

          <Card className="grid gap-4 p-6">
            <MetricCard label="Reachable runtimes" value={String(rolloutTargets)} />
            <MetricCard label="Linked runtimes" value={String(linkedInstances)} />
            <MetricCard
              label="Rollout mode"
              value="Image only"
              tone="accent"
            />
          </Card>
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
        "grid gap-2 rounded-xl px-4 py-4",
        tone === "accent"
          ? "bg-primary/15"
          : "bg-card",
      )}
    >
      <span className="text-xs font-semibold text-muted-foreground">
        {label}
      </span>
      <span className="text-xl leading-none tracking-tight text-foreground">
        {value}
      </span>
    </div>
  );
}
