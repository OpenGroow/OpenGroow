"use client";

import { useEffect, useState } from "react";
import { ProvidersPageContent } from "@/src/components/providers-page-content";

type Props = { params: Promise<{ projectId: string }> };

export default function ProjectProvidersPage({ params }: Props) {
  const [resolvedId, setResolvedId] = useState("");
  useEffect(() => {
    void params.then(({ projectId }) => setResolvedId(decodeURIComponent(projectId)));
  }, [params]);
  return <ProvidersPageContent resolvedInstanceId={resolvedId} />;
}
