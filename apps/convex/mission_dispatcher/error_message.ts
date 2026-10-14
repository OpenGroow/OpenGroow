// Exported for reuse by other "use node" modules that need the same
// unknown-to-string coercion for a caught error (e.g. missions_node.ts's
// auto-publish chain).
export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
