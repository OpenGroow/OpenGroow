"use client";

import { rowClass } from "./styles";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function CreateInstanceControls({
  nameSuffix,
  onNameSuffixChange,
  openClawImageRef,
  onOpenClawImageRefChange,
  jobId,
  onJobIdChange,
  loading,
  onSubmit,
  onRefresh,
  onRollout,
  onDestroyAll,
}: {
  nameSuffix: string;
  onNameSuffixChange: (value: string) => void;
  openClawImageRef: string;
  onOpenClawImageRefChange: (value: string) => void;
  jobId: string;
  onJobIdChange: (value: string) => void;
  loading: boolean;
  onSubmit: () => void;
  onRefresh: () => void;
  onRollout: (refreshCompose?: boolean) => void;
  onDestroyAll: () => void;
}) {
  return (
    <>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Input
          value={nameSuffix}
          onChange={(event) => onNameSuffixChange(event.target.value)}
          className="w-auto"
          aria-label="Project name suffix"
          placeholder="name suffix (optional)"
        />
        <Input
          value={openClawImageRef}
          onChange={(event) => onOpenClawImageRefChange(event.target.value)}
          className="w-auto"
          aria-label="openclaw image ref"
          placeholder="OpenClaw image ref (optional)"
        />
        <Button variant="outline" size="sm"  onClick={() => onSubmit()} disabled={loading}>
          {loading ? "Creating..." : "Create Project"}
        </Button>
      </div>

      <div className={rowClass}>
        <Input
          value={jobId}
          onChange={(event) => onJobIdChange(event.target.value)}
          className="w-auto"
          aria-label="job id"
          placeholder="job id"
        />
        <Button variant="outline" size="sm"  onClick={() => onRefresh()} disabled={loading}>
          {loading ? "Refreshing..." : "Refresh job"}
        </Button>
      </div>

      <div className={rowClass}>
        <Button variant="outline" size="sm"  onClick={() => onRollout()} disabled={loading}>
          {loading ? "Rolling out..." : "Rollout all Projects"}
        </Button>
        <Button variant="outline" size="sm"  onClick={() => onRollout(true)} disabled={loading}>
          {loading ? "Bootstrapping..." : "Rollout + bootstrap"}
        </Button>
        <Button variant="outline" size="sm"  onClick={() => onDestroyAll()}>
          Destroy all Projects
        </Button>
      </div>
    </>
  );
}
