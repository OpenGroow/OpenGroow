import type { ReactNode } from "react";
import { MissionRunShell } from "@/src/components/mission-run-page";

export default async function Layout({
  params,
  children,
}: {
  params: Promise<{ projectId: string; missionId: string; runId: string }>;
  children: ReactNode;
}) {
  const { projectId, missionId, runId } = await params;
  return (
    <MissionRunShell
      instanceId={decodeURIComponent(projectId)}
      missionId={decodeURIComponent(missionId)}
      runId={decodeURIComponent(runId)}
    >
      {children}
    </MissionRunShell>
  );
}
