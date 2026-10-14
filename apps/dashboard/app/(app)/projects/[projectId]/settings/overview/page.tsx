"use client";

import { OverviewPageContent } from "@/src/components/overview-page-content";
import { useResolvedProjectId } from "@/src/hooks/use-resolved-project-id";

type Props = { params: Promise<{ projectId: string }> };

export default function OverviewPage({ params }: Props) {
  return <OverviewPageContent resolvedInstanceId={useResolvedProjectId(params)} />;
}
