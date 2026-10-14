"use node";

import { createLocalControlServer } from "./local-control-server.js";
import { defaultDockerRunner } from "./default-docker-runner.js";
import { discoverExistingInstances } from "./discover-instances.js";

const server = createLocalControlServer();

// Reseed the in-memory registry (issue #305) from whatever Compose projects
// this service already created before this restart — otherwise the very
// next create would be free to re-allocate an in-use port, and the very
// next broker key sync (issue #307) would silently drop every existing
// instance's key. A request landing in the brief window before this
// completes is the same in-memory-only exposure the registry already had.
for (const instance of await discoverExistingInstances(defaultDockerRunner)) {
  server.registry.add(instance);
}

// Re-sync the broker's on-disk OpenClaw-keys file to match the just-reseeded
// registry. Without this, the broker keeps serving whatever key set was
// written by the last create/remove call before this restart — if that
// snapshot predates one or more of the instances just rediscovered above,
// the broker silently rejects their runtime-worker connections (wrong/
// missing keyId) forever, since nothing else ever re-triggers a sync.
const { brokerSyncError } = await server.syncBrokerKeys();
if (brokerSyncError) {
  console.error(`[openclaw-local-control] startup broker key sync failed: ${brokerSyncError}`);
}

// The initial sync above already handled the broker start caused by this
// process. Clear that one-shot expectation before subscribing to future
// Docker events, otherwise the first user-triggered broker restart could be
// mistaken for our own restart and skipped.
server.clearExpectedBrokerStart();
server.startDockerEvents();
