// Convex wraps a server-side `throw new Error("msg")` into a multi-line client
// error whose `.message` looks like:
//
//   [CONVEX M(missions:deleteMission)] [Request ID: abc] Server Error
//   Uncaught Error: Cannot delete a mission while its run is in flight
//       at handler (../convex/missions.ts:200:13)
//
// Surfacing that raw string in an alert is noisy. This extracts just the thrown
// message — the line after `Uncaught <...>Error:` — falling back gracefully.
export function extractConvexErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) return fallback;
  const match = error.message.match(/Uncaught (?:\w*Error|ConvexError): (.+)/);
  if (match) return match[1].trim();
  return error.message.trim() || fallback;
}
