// Deterministic increment from a base port, checked against already-known
// instances (issue #305's Implementation Decisions) — not an OS-assigned
// ephemeral port, so allocations are reproducible and inspectable.
export function allocatePort(usedPorts: ReadonlySet<number>, basePort: number): number {
  let port = basePort;
  while (usedPorts.has(port)) {
    port += 1;
  }
  return port;
}
