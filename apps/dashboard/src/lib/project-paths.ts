/**
 * Where a Project opens: its first work section. (The Overview lives under
 * Settings, with the project name.)
 */
export function projectHomePath(projectId: string): string {
  return `/projects/${projectId}/missions`;
}
