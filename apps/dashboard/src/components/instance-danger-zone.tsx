"use client";

import { useRouter } from "next/navigation";
import { useAction } from "convex/react";
import { api } from "@convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

type InstanceDangerZoneProps = {
  jobId?: string;
};

export function InstanceDangerZone({ jobId }: InstanceDangerZoneProps) {
  const router = useRouter();
  const removeInstanceFromInfra = useAction(api.instances_node.removeInstance);

  async function handleDeleteInstance(): Promise<void> {
    if (!jobId) {
      window.alert("Project job id missing");
      return;
    }

    const confirmed = window.confirm(
      "Delete this project from infrastructure and remove it from the dashboard?",
    );
    if (!confirmed) {
      return;
    }

    try {
      const data = await removeInstanceFromInfra({ jobId });

      if ("error" in data) {
        window.alert(data.error);
        return;
      }
      if (data.ok !== true) {
        window.alert("Project deletion failed");
        return;
      }

      router.replace("/");
      router.refresh();
    } catch (error: unknown) {
      window.alert(
        error instanceof Error ? error.message : "Failed to delete project",
      );
    }
  }

  return (
    <Card className="gap-5 bg-destructive/10 py-6">
      <CardContent className="grid gap-4 px-6 pt-0">
        <div className="grid gap-2">
          <h3 className="text-lg tracking-tight text-destructive">
            Danger Zone
          </h3>
          <p className="max-w-2xl text-base leading-7 text-destructive">
            Permanently delete this Project from the infrastructure and remove
            it from the dashboard.
          </p>
        </div>
        <div className="rounded-xl border border-destructive/30 bg-muted px-4 py-4 text-sm leading-6 text-destructive">
          This action deletes the Project and its remote runtime and cannot be undone.
        </div>
        <div className="flex flex-wrap gap-3">
          <Button variant="destructive" size="lg"
            type="button"
            onClick={() => void handleDeleteInstance()}
          >
            Delete Project
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
