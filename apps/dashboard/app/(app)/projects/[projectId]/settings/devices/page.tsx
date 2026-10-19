"use client";

import { useEffect, useState } from "react";
import { ArrowLeft } from "lucide-react";
import type { InstanceRecord } from "@/src/components/instance-workspace.types";
import { ConnectLinkWizard } from "@/src/components/instance-workspace/connect-link-wizard";
import { DevicesList } from "@/src/components/instance-workspace/devices-list";
import { useAuthenticatedInstances } from "@/src/hooks/use-authenticated-instances";
import { Button } from "@/components/ui/button";

type DevicesPageProps = {
  params: Promise<{ projectId: string }>;
};

export default function InstanceDevicesPage({ params }: DevicesPageProps) {
  const [resolvedInstanceId, setResolvedInstanceId] = useState("");
  const [showWizard, setShowWizard] = useState(false);
  const instances = useAuthenticatedInstances<InstanceRecord>();

  useEffect(() => {
    void params.then(({ projectId }) => {
      setResolvedInstanceId(decodeURIComponent(projectId));
    });
  }, [params]);

  const instance = instances?.find(
    (entry) =>
      entry.openclawId === resolvedInstanceId || entry.jobId === resolvedInstanceId,
  );

  if (!instance) {
    return null;
  }

  if (showWizard) {
    return (
      <section className="grid gap-5">
        <div>
          <Button size="lg"
            type="button"
            variant="ghost"
            onClick={() => setShowWizard(false)}
          >
            <ArrowLeft className="mr-1.5 size-4" />
            Back to devices
          </Button>
        </div>
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
