"use client";

import { buttonChipClass, inputChipClass, rowClass } from "./styles";

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
        <input
          value={nameSuffix}
          onChange={(event) => onNameSuffixChange(event.target.value)}
          className={inputChipClass}
          aria-label="Project name suffix"
          placeholder="name suffix (optional)"
        />
        <input
          value={openClawImageRef}
          onChange={(event) => onOpenClawImageRefChange(event.target.value)}
          className={inputChipClass}
          aria-label="openclaw image ref"
          placeholder="OpenClaw image ref (optional)"
        />
        <button className={buttonChipClass} onClick={() => onSubmit()} disabled={loading}>
          {loading ? "Creating..." : "Create Project"}
        </button>
      </div>

      <div className={rowClass}>
        <input
          value={jobId}
          onChange={(event) => onJobIdChange(event.target.value)}
          className={inputChipClass}
          aria-label="job id"
          placeholder="job id"
        />
        <button className={buttonChipClass} onClick={() => onRefresh()} disabled={loading}>
          {loading ? "Refreshing..." : "Refresh job"}
        </button>
      </div>

      <div className={rowClass}>
        <button className={buttonChipClass} onClick={() => onRollout()} disabled={loading}>
          {loading ? "Rolling out..." : "Rollout all Projects"}
        </button>
        <button className={buttonChipClass} onClick={() => onRollout(true)} disabled={loading}>
          {loading ? "Bootstrapping..." : "Rollout + bootstrap"}
        </button>
        <button className={buttonChipClass} onClick={() => onDestroyAll()}>
          Destroy all Projects
        </button>
      </div>
    </>
  );
}
