"use client";

import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { useAction, useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import type { InstanceRecord } from "@/src/components/instance-workspace.types";
import { findInstanceById } from "@/src/components/instance-workspace.utils";
import { PROJECT_NAME_MAX_LENGTH } from "@/src/components/project-name-dialog";
import { useAuthenticatedInstances } from "@/src/hooks/use-authenticated-instances";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

type Props = { resolvedInstanceId: string };

export function OverviewPageContent({ resolvedInstanceId }: Props) {
  const [versionStatus, setVersionStatus] = useState<"idle" | "refreshing" | "error">(
    "idle",
  );
  const [versionError, setVersionError] = useState("");

  const instances = useAuthenticatedInstances<InstanceRecord>();
  const refreshOpenClawVersion = useAction(
    api.runtime_commands_node.refreshOpenClawVersion,
  );

  const instance = findInstanceById(instances, resolvedInstanceId);

  const openclawId = instance?.openclawId;

  if (!instance || !resolvedInstanceId) {
    return null;
  }

  async function handleRefreshVersion(): Promise<void> {
    if (!openclawId || versionStatus === "refreshing") {
      return;
    }

    setVersionStatus("refreshing");
    setVersionError("");

    try {
      const result = await refreshOpenClawVersion({
        instanceId: openclawId,
      });
      if (!result.ok) {
        setVersionStatus("error");
        setVersionError(result.error ?? "OpenClaw version refresh failed");
        return;
      }
      setVersionStatus("idle");
    } catch (error: unknown) {
      setVersionStatus("error");
      setVersionError(
        error instanceof Error
          ? error.message
          : "OpenClaw version refresh failed",
      );
    }
  }

  return (
    <section className="grid gap-8">
      <ProjectNameCard jobId={instance.jobId} displayName={instance.displayName} />

      <Card className="gap-5 rounded-[1.5rem] border-0 bg-white/92 py-6 shadow-[0_18px_48px_rgba(25,28,28,0.08)] ring-1 ring-[rgba(0,38,27,0.08)]">
        <CardHeader className="grid gap-2 px-6 pb-0">
          <CardTitle className="text-[1.35rem] leading-[1.1] tracking-[-0.04em] text-[var(--dashboard-ink)]">
            OpenClaw Version
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 px-6">
          <div className="grid gap-1">
            <p className="text-sm uppercase tracking-[0.12em] text-[var(--dashboard-ink-muted)]">
              Current version
            </p>
            <p className="text-[1.2rem] leading-7 text-[var(--dashboard-ink)]">
              {formatOpenClawVersion(instance.openclawVersion)}
            </p>
            <p className="text-sm text-[var(--dashboard-ink-muted)]">
              {instance.openclawVersionUpdatedAt
                ? `Last refresh ${formatOverviewTimestamp(instance.openclawVersionUpdatedAt)}`
                : "No runtime version has been recorded yet."}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="button"
              disabled={!openclawId || versionStatus === "refreshing"}
              onClick={() => void handleRefreshVersion()}
              className="h-11 rounded-xl bg-[rgba(220,230,224,0.66)] px-5 text-[var(--dashboard-primary)] hover:bg-[rgba(220,230,224,0.82)]"
            >
              {versionStatus === "refreshing" ? "Refreshing version…" : "Refresh version"}
            </Button>
          </div>

          {versionError ? (
            <p className="text-sm text-[var(--dashboard-tertiary)]">{versionError}</p>
          ) : null}
        </CardContent>
      </Card>
    </section>
  );
}

// `openclaw --version` prints "OpenClaw 2026.9.1 (ad6fe23)": keep the release.
function formatOpenClawVersion(raw: string | undefined): string {
  if (!raw) {
    return "Unknown";
  }
  return /\d{4}\.\d+\.\d+\S*/.exec(raw)?.[0] ?? raw;
}

function formatOverviewTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString();
}

function ProjectNameCard({ jobId, displayName }: { jobId: string; displayName?: string }) {
  const renameInstance = useMutation(api.instances.renameInstance);
  const savedName = displayName?.trim() ?? "";
  const [name, setName] = useState(savedName);
  const [status, setStatus] = useState<"idle" | "saving" | "error">("idle");
  const [error, setError] = useState("");

  useEffect(() => {
    setName(savedName);
  }, [savedName]);

  const trimmedName = name.trim();
  const canSave =
    status !== "saving" &&
    trimmedName.length > 0 &&
    trimmedName.length <= PROJECT_NAME_MAX_LENGTH &&
    trimmedName !== savedName;

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!canSave) {
      return;
    }
    setStatus("saving");
    setError("");
    try {
      await renameInstance({ jobId, displayName: trimmedName });
      setStatus("idle");
    } catch (submitError: unknown) {
      setStatus("error");
      setError(submitError instanceof Error ? submitError.message : "Failed to save the project name");
    }
  }

  return (
    <Card className="gap-5 rounded-[1.5rem] border-0 bg-white/92 py-6 shadow-[0_18px_48px_rgba(25,28,28,0.08)] ring-1 ring-[rgba(0,38,27,0.08)]">
      <CardHeader className="grid gap-2 px-6 pb-0">
        <CardTitle className="text-[1.35rem] leading-[1.1] tracking-[-0.04em] text-[var(--dashboard-ink)]">
          Project name
        </CardTitle>
        <CardDescription className="max-w-2xl text-base leading-7 text-[var(--dashboard-ink-muted)]">
          The name shown for this project.
        </CardDescription>
      </CardHeader>
      <CardContent className="px-6">
        <form className="grid gap-3" onSubmit={(event) => void handleSubmit(event)}>
          <Label htmlFor="project-name" className="sr-only">
            Project name
          </Label>
          <Input
            id="project-name"
            value={name}
            placeholder="e.g. Marketing Ops"
            maxLength={PROJECT_NAME_MAX_LENGTH}
            onChange={(event) => setName(event.target.value)}
            className="h-12 max-w-xl rounded-xl border-[rgba(0,38,27,0.1)] bg-white px-4"
          />
          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="submit"
              disabled={!canSave}
              className="h-11 rounded-xl bg-[var(--dashboard-primary)] px-5 text-[var(--dashboard-on-primary)] hover:bg-[var(--dashboard-primary-container)]"
            >
              {status === "saving" ? "Saving…" : "Save name"}
            </Button>
            {error ? <span className="text-sm text-[var(--dashboard-tertiary)]">{error}</span> : null}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
