"use client";

import { useRef, useState } from "react";
import type { InstanceRecord } from "@/src/components/instance-workspace.types";
import { ConnectLinkWizard } from "@/src/components/instance-workspace/connect-link-wizard";
import { DevicesList } from "@/src/components/instance-workspace/devices-list";
import { useAuthenticatedInstances } from "@/src/hooks/use-authenticated-instances";

export function DevicesPageContent({
  resolvedInstanceId,
}: {
  resolvedInstanceId: string;
}) {
  const [showWizard, setShowWizard] = useState(false);
  const instances = useAuthenticatedInstances<InstanceRecord>();

  const liveInstance = instances?.find(
    (entry) =>
      entry.openclawId === resolvedInstanceId || entry.jobId === resolvedInstanceId,
  );
  // Keep the last known instance so a momentary Convex disconnect doesn't
  // unmount the wizard mid-pairing (which would reset it to step 1).
  const instanceRef = useRef<InstanceRecord | undefined>(undefined);
  if (liveInstance) instanceRef.current = liveInstance;
  const instance = liveInstance ?? instanceRef.current;

  if (!instance) {
    return null;
  }

  if (showWizard) {
    return (
      <section className="grid gap-5">
        <ConnectLinkWizard
          instance={instance}
          startFresh
          onConnected={() => setShowWizard(false)}
        />
      </section>
    );
  }

  return (
    <section className="grid gap-5">
      <DevicesList
        instance={instance}
        onAddDevice={() => setShowWizard(true)}
        onEmpty={() => setShowWizard(true)}
      />
    </section>
  );
}
