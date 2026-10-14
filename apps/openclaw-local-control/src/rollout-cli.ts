"use node";

import { loadLocalControlConfig } from "./config.js";
import { defaultComposeRunner } from "./default-compose-runner.js";
import { defaultDockerRunner } from "./default-docker-runner.js";
import { rolloutInstances } from "./rollout.js";

// Dev-loop helper, run via `pnpm --filter @opengroow/openclaw-local-control
// rollout` — also invoked automatically by `pnpm openclaw:local`
// (apps/openclaw-docker-config/scripts/local-stack.sh) right after it
// rebuilds the `:local` gateway/runtime-worker images. Recreates every
// existing local instance's Compose project against the rebuilt image —
// without this, an already-running instance keeps its stale container
// until it's manually deleted and recreated from the dashboard, since
// Compose never hot-swaps a running container just because its image tag
// was rebuilt.
const results = await rolloutInstances({
  config: loadLocalControlConfig(),
  composeRunner: defaultComposeRunner,
  dockerRunner: defaultDockerRunner,
});

if (results.length === 0) {
  console.log("[rollout] no local instances found — nothing to do.");
  process.exit(0);
}

let failed = 0;
for (const result of results) {
  if (result.ok) {
    console.log(`[rollout] ${result.id}: recreated`);
  } else {
    failed += 1;
    console.error(`[rollout] ${result.id}: FAILED — ${result.error}`);
  }
}

console.log(`[rollout] ${results.length - failed}/${results.length} instance(s) recreated.`);
process.exit(failed > 0 ? 1 : 0);
