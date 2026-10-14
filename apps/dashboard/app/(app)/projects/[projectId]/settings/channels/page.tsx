"use client";

import { useEffect, useState } from "react";
import { ChannelsPageContent } from "@/src/components/channels-page-content";

type Props = { params: Promise<{ projectId: string }> };

export default function ChannelsPage({ params }: Props) {
  const [resolvedId, setResolvedId] = useState("");
  useEffect(() => {
    void params.then(({ projectId }) => setResolvedId(decodeURIComponent(projectId)));
  }, [params]);
  return <ChannelsPageContent resolvedInstanceId={resolvedId} />;
}
