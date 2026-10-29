/**
 * Where a Project opens: its Overview. (The project name and OpenClaw version
 * live under Settings > Overview.)
 */
export function projectHomePath(projectId: string): string {
  return `/projects/${projectId}/overview`;
}
