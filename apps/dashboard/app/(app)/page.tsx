import { fetchBrokerHealth } from "@/src/lib/health";
import { DashboardHome } from "@/src/components/dashboard-home";

export const dynamic = "force-dynamic";

type HomeProps = {
  searchParams?: Promise<{ openClawId?: string }>;
};

// Issue #306: self-host now shares this same multi-Project list/creation UI
// with SaaS — local-multi provisioning (issue #303/#305) removed the
// single-Project constraint that made a separate self-host-only home
// (dashboard-home-selfhost.tsx, retired by this issue) necessary. See
// ADR-033 (docs/adr/033-local-multi-is-the-only-self-host-provisioning-model.md) for why that split is gone.
export default async function Home({ searchParams }: HomeProps) {
  const params = searchParams ? await searchParams : undefined;
  const openClawId = params?.openClawId;
  const health = await fetchBrokerHealth();

  return <DashboardHome focusInstanceId={openClawId} health={health} />;
}
