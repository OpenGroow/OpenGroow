"use client";

import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { useAction, useMutation } from "convex/react";
import { Box, Pencil, RefreshCw, Save } from "lucide-react";
import { api } from "@convex/_generated/api";
import type { InstanceRecord } from "@/src/components/instance-workspace.types";
import { findInstanceById } from "@/src/components/instance-workspace.utils";
import { PROJECT_NAME_MAX_LENGTH } from "@/src/components/project-name-dialog";
import { useAuthenticatedInstances } from "@/src/hooks/use-authenticated-instances";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SettingsCard } from "@/components/opengroow/settings-panel";

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
    <section className="grid gap-6">
      <ProjectNameCard jobId={instance.jobId} displayName={instance.displayName} />

      <SettingsCard
        icon={Box}
        tone="blue"
        title="OpenClaw Version"
        description="Current version and system information."
      >
        <div className="flex flex-wrap items-center justify-between gap-6">
          <div className="flex items-center gap-8">
            <div className="grid gap-1">
              <p className="m-0 text-xs font-medium tracking-wide text-muted-foreground uppercase">
                Current version
              </p>
              <p className="m-0 text-2xl font-semibold text-foreground tabular-nums">
                {formatOpenClawVersion(instance.openclawVersion)}
              </p>
            </div>
            <div className="grid gap-1 border-l border-border pl-8">
              <p className="m-0 text-xs font-medium tracking-wide text-muted-foreground uppercase">
                Last refresh
              </p>
              <p className="m-0 text-base text-muted-foreground tabular-nums">
                {instance.openclawVersionUpdatedAt
                  ? formatOverviewTimestamp(instance.openclawVersionUpdatedAt)
                  : "No runtime version has been recorded yet."}
              </p>
            </div>
          </div>
          <Button
            variant="accent"
            size="lg"
            type="button"
            loading={versionStatus === "refreshing"}
            disabled={!openclawId}
            onClick={() => void handleRefreshVersion()}
          >
            {versionStatus === "refreshing" ? null : <RefreshCw />}
            {versionStatus === "refreshing" ? "Refreshing version…" : "Refresh version"}
          </Button>
        </div>
        {versionError ? <p className="m-0 text-sm text-destructive">{versionError}</p> : null}
      </SettingsCard>
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
    <SettingsCard icon={Pencil} tone="blue" title="Project name" description="The name shown for this project.">
      <form className="flex flex-wrap gap-3" onSubmit={(event) => void handleSubmit(event)}>
        <Label htmlFor="project-name" className="sr-only">
          Project name
        </Label>
        <Input
          id="project-name"
          value={name}
          placeholder="e.g. Marketing Ops"
          maxLength={PROJECT_NAME_MAX_LENGTH}
          onChange={(event) => setName(event.target.value)}
          className="h-11 w-full max-w-md"
        />
        <Button size="lg" type="submit" disabled={!canSave}>
          {status === "saving" ? null : <Save />}
          {status === "saving" ? "Saving…" : "Save"}
        </Button>
        {error ? <span className="w-full text-sm text-destructive">{error}</span> : null}
      </form>
    </SettingsCard>
  );
}
