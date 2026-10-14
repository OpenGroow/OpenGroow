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
    <Card className="gap-5 rounded-[1.5rem] border-0 bg-[rgba(126,61,53,0.04)] py-6 shadow-[0_18px_48px_rgba(25,28,28,0.08)] ring-1 ring-[rgba(126,61,53,0.16)]">
      <CardContent className="grid gap-4 px-6 pt-0">
        <div className="grid gap-2">
          <h3 className="text-[1.35rem] leading-[1.1] tracking-[-0.04em] text-[#7e3d35]">
            Danger Zone
          </h3>
          <p className="max-w-2xl text-base leading-7 text-[rgba(126,61,53,0.82)]">
            Permanently delete this Project from the infrastructure and remove
            it from the dashboard.
          </p>
        </div>
        <div className="rounded-[1.25rem] border border-[rgba(126,61,53,0.16)] bg-[rgba(253,214,205,0.22)] px-4 py-4 text-sm leading-6 text-[#7e3d35]">
          This action deletes the Project and its remote runtime and cannot be undone.
        </div>
        <div className="flex flex-wrap gap-3">
          <Button
            type="button"
            onClick={() => void handleDeleteInstance()}
            className="h-11 rounded-xl bg-[#7e3d35] px-5 text-white hover:bg-[#6d342d]"
          >
            Delete Project
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
