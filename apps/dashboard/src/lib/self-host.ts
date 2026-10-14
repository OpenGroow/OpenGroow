import { redirect } from "next/navigation";
import { projectHomePath } from "@/src/lib/project-paths";
import type { InstanceView } from "@/src/components/instance-workspace.types";

/**
 * Single source of truth for self-host detection (ADR-033). Read once per
 * request from a server component/route — never inline `process.env
 * .IS_SELF_HOST === "1"` at call sites, so a future change to how self-host
 * is detected only touches this file.
 */
export function isSelfHost(): boolean {
  return process.env.IS_SELF_HOST === "1";
}

/**
 * Project sub-pages that only make sense for hosted (non self-host) projects
 * — self-host owners manage their own infra/updates directly (docker
 * compose, ssh) instead of through OpenGroow's hosted-only admin actions.
 * The single list driving both nav visibility (project-layout-client.tsx)
 * and route access (each hosted-only page.tsx via `redirectIfSelfHost`).
 *
 * "security" used to be hosted-only too, back when self-host meant exactly
 * one hardcoded instance (issue #262/ADR-028) — deleting it made no sense
 * from inside the dashboard when there was nothing else to switch to.
 * Local-multi (issue #303/#306) reintroduced multiple self-host Projects,
 * each its own Compose project managed through openclaw-local-control, so
 * self-host now needs this page's Danger Zone (instance-danger-zone.tsx)
 * to delete one without a shell.
 */
export const HOSTED_ONLY_VIEWS: ReadonlySet<InstanceView> = new Set<InstanceView>([
  "developer",
]);

/** Redirects self-host requests away from a hosted-only project sub-page. */
export function redirectIfSelfHost(projectId: string): void {
  if (isSelfHost()) {
    redirect(projectHomePath(projectId));
  }
}
