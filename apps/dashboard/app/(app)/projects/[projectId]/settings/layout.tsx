import type { ReactNode } from "react";
import { SettingsTabs } from "@/src/components/settings-tabs";
import { PageHeader } from "@/components/opengroow/page-header";

export default async function Layout({
  params,
  children,
}: {
  params: Promise<{ projectId: string }>;
  children: ReactNode;
}) {
  const { projectId } = await params;
  return (
    <section className="grid max-w-4xl gap-6">
      <PageHeader title="Settings" description="Configuration, integrations and account." />
      <SettingsTabs projectId={decodeURIComponent(projectId)} />
      {children}
    </section>
  );
}
