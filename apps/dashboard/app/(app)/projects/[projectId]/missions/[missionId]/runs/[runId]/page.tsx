import { redirect } from "next/navigation";
import { missionRunHref } from "@/src/lib/instance-path";

export default async function Page({
  params,
}: {
  params: Promise<{ projectId: string; missionId: string; runId: string }>;
}) {
  const { projectId, missionId, runId } = await params;
  redirect(
    missionRunHref(decodeURIComponent(projectId), decodeURIComponent(missionId), decodeURIComponent(runId), "prompt"),
  );
}
