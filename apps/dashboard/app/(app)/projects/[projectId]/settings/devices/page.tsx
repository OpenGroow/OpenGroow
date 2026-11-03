import { DevicesPageContent } from "@/src/components/devices-page-content";

type DevicesPageProps = {
  params: Promise<{ projectId: string }>;
};

export default async function InstanceDevicesPage({ params }: DevicesPageProps) {
  const { projectId } = await params;
  return <DevicesPageContent resolvedInstanceId={decodeURIComponent(projectId)} />;
}
