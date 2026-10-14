"use client";

import { SecurityPageContent } from "@/src/components/security-page-content";
import { useResolvedProjectId } from "@/src/hooks/use-resolved-project-id";

type Props = { params: Promise<{ projectId: string }> };

export default function SecurityPage({ params }: Props) {
  return <SecurityPageContent resolvedInstanceId={useResolvedProjectId(params)} />;
}
