"use client";

import { useEffect, useState } from "react";

/** Decodes the `[projectId]` route param out of its async params promise. */
export function useResolvedProjectId(params: Promise<{ projectId: string }>): string {
  const [resolvedProjectId, setResolvedProjectId] = useState("");

  useEffect(() => {
    void params.then(({ projectId }) => {
      setResolvedProjectId(decodeURIComponent(projectId));
    });
  }, [params]);

  return resolvedProjectId;
}
