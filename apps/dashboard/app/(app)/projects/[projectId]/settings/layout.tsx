import type { ReactNode } from "react";
import { SettingsTabs } from "@/src/components/settings-tabs";

export default async function Layout({
  params,
  children,
}: {
  params: Promise<{ projectId: string }>;
  children: ReactNode;
}) {
  const { projectId } = await params;
  return (
    <section className="grid gap-6">
      <header className="grid gap-3">
        <h1 className="m-0 text-[clamp(1.8rem,3vw,2.6rem)] leading-[1.02] tracking-[-0.05em] text-[var(--dashboard-primary)]">
          Settings
        </h1>
        <SettingsTabs projectId={decodeURIComponent(projectId)} />
      </header>
      {children}
    </section>
  );
}
