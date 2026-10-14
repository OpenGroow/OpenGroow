import type { AddressInfo } from "node:net";
import { Hono, type Context } from "hono";
import { serve } from "@hono/node-server";
import { HmacVerifier } from "@opengroow/hmac";
import { loadLocalControlConfig, type LocalControlConfig } from "./config.js";
import type { ComposeRunner } from "./compose-runner.js";
import { defaultComposeRunner } from "./default-compose-runner.js";
import type { DockerRunner } from "./default-docker-runner.js";
import { defaultDockerRunner } from "./default-docker-runner.js";
import { InstanceRegistry } from "./registry.js";
import { ComposeCommandError, createInstance, removeInstance, type ComposeDeps } from "./instances.js";
import { buildOpenClawKeyRegistry, syncBrokerOpenClawKeys } from "./broker-sync.js";
import { DockerEventWatcher } from "./docker-event-watcher.js";
import { registerReadRoutes } from "./read-routes.js";

type KeyRegistry = Record<string, { secret: string }>;

// Default key registry (key id "convex", matching OPENCLAW_CONTROL_KEY_ID), overridden in
// deployment via OPENCLAW_LOCAL_CONTROL_KEYS.
const DEFAULT_KEYS: KeyRegistry = {
  convex: { secret: "convex-secret" }
};

export type LocalControlServerOptions = {
  port?: number;
  basePort?: number;
  log?: boolean;
  composeRunner?: ComposeRunner;
  dockerRunner?: DockerRunner;
  registry?: InstanceRegistry;
  config?: LocalControlConfig;
  keys?: KeyRegistry;
};

export type LocalControlServer = {
  app: Hono;
  server: ReturnType<typeof serve>;
  port: number;
  registry: InstanceRegistry;
  syncBrokerKeys: () => Promise<{ brokerSyncError?: string }>;
  clearExpectedBrokerStart: () => void;
  startDockerEvents: () => void;
  close: () => Promise<void>;
};

export function createLocalControlServer(
  options: LocalControlServerOptions = {}
): LocalControlServer {
  const baseConfig = options.config ?? loadLocalControlConfig();
  const config: LocalControlConfig = {
    ...baseConfig,
    basePort: options.basePort ?? baseConfig.basePort
  };
  const registry = options.registry ?? new InstanceRegistry();
  const composeRunner = options.composeRunner ?? defaultComposeRunner;
  const dockerRunner = options.dockerRunner ?? defaultDockerRunner;
  const composeDeps: ComposeDeps = { config, registry, composeRunner };
  const port = options.port ?? config.port;
  const keys = options.keys ?? loadKeys(config.keysRaw, config.requireExplicitKeys);
  // Every cross-service HTTP call is signed (docs/HMAC.md) — this endpoint
  // set follows the HMAC-gated control API of docs/CONTROL_PLANE.md, since it
  // will eventually be called by Convex the same way.
  const verifier = new HmacVerifier({
    keyRegistry: keys,
    prefix: "control",
    skewMs: config.hmacMaxSkewMs,
    nonceTtlMs: config.hmacMaxSkewMs * 2
  });

  const app = new Hono();

  // Broker key propagation (issue #303's Implementation Decisions, wired in
  // issue #307): regenerate the broker's OpenClaw-keys file from every
  // currently known instance and restart the broker container so it picks
  // up the change (no new broker admin/hot-register endpoint — the broker
  // only ever loads its key registry once, at startup). Best-effort: a sync
  // failure is surfaced as a `brokerSyncError` field alongside the
  // otherwise-successful create/remove response rather than failing it —
  // the compose operation itself already succeeded (containers/volumes are
  // in the state the caller asked for), and there's nothing to safely roll
  // back in response to a secondary side effect failing.
  // Serializes concurrent syncs: two create/remove requests in flight at
  // once each finish their own compose op independently, but without this
  // chain their docker-cp-then-restart pairs could interleave, and whichever
  // one's restart lands last would win regardless of whether its
  // registry.list() snapshot was actually the most recent — silently
  // leaving the broker with a stale key set. Chaining onto the same promise
  // both serializes the docker calls and, just as importantly, defers each
  // registry.list() snapshot until it's that request's actual turn to run,
  // so it always reflects every mutation queued ahead of it.
  let brokerSyncChain: Promise<void> = Promise.resolve();
  let expectedBrokerStart = false;
  let dockerEventWatcher: DockerEventWatcher | null = null;

  const consumeExpectedBrokerStart = (): boolean => {
    if (!expectedBrokerStart) return false;
    expectedBrokerStart = false;
    return true;
  };

  async function syncBrokerKeys(): Promise<{ brokerSyncError?: string }> {
    const run = brokerSyncChain.then(async () => {
      const keys = buildOpenClawKeyRegistry(registry.list());
      expectedBrokerStart = true;
      try {
        await syncBrokerOpenClawKeys(
          { dockerRunner, brokerContainer: config.brokerContainer, brokerKeysFilePath: config.brokerKeysFilePath },
          keys,
        );
      } catch (error) {
        expectedBrokerStart = false;
        throw error;
      }
    });
    brokerSyncChain = run.catch(() => {});
    try {
      await run;
      return {};
    } catch (error: unknown) {
      const brokerSyncError = error instanceof Error ? error.message : "Failed to sync broker OpenClaw keys";
      return { brokerSyncError };
    }
  }

  function startDockerEvents(): void {
    if (!config.dockerEventsEnabled || dockerEventWatcher) return;
    dockerEventWatcher = new DockerEventWatcher({
      containerName: config.brokerContainer,
      log: (message) => {
        if (options.log !== false) console.log(`[openclaw-local-control] ${message}`);
      },
      warn: (message) => console.warn(`[openclaw-local-control] ${message}`),
      onContainerStarted: async () => {
        if (consumeExpectedBrokerStart()) return;
        if (options.log !== false) {
          console.log("[openclaw-local-control] broker restarted; resyncing OpenClaw keys");
        }
        const result = await syncBrokerKeys();
        if (result.brokerSyncError) {
          console.warn(`[openclaw-local-control] broker key resync failed: ${result.brokerSyncError}`);
        }
      },
    });
    dockerEventWatcher.start();
  }

  app.get("/health", (c) => {
    return c.json({ status: 200, ok: true, service: "@opengroow/openclaw-local-control" }, 200);
  });

  app.post("/instances", async (c) => {
    const rawBody = await c.req.text();
    const authError = authenticate(verifier, c, rawBody);
    if (authError) {
      return authError;
    }
    try {
      const instance = await createInstance(composeDeps);
      return c.json({ status: 201, ...instance, ...(await syncBrokerKeys()) }, 201);
    } catch (error: unknown) {
      return composeErrorResponse(c, error, "Failed to create instance");
    }
  });

  app.delete("/instances/:id", async (c) => {
    const authError = authenticate(verifier, c, "");
    if (authError) {
      return authError;
    }
    const id = c.req.param("id");
    if (!registry.get(id)) {
      return c.json({ status: 404, error: "Instance not found" }, 404);
    }
    try {
      const result = await removeInstance(composeDeps, id);
      return c.json({ status: 200, id, ...result, ...(await syncBrokerKeys()) }, 200);
    } catch (error: unknown) {
      return composeErrorResponse(c, error, "Failed to remove instance");
    }
  });

  registerReadRoutes(app, {
    registry,
    composeDeps,
    dockerRunner,
    config,
    verifier,
    authenticate,
    composeErrorResponse
  });

  app.notFound((c) => c.json({ status: 404, error: "Not found" }, 404));

  const server = serve({ fetch: app.fetch, port }, () => {
    if (options.log !== false) {
      console.log(`[openclaw-local-control] listening on http://localhost:${actualPort()}`);
    }
  });

  function actualPort(): number {
    const address = server.address() as AddressInfo | null;
    return address?.port ?? port;
  }

  return {
    app,
    server,
    port: actualPort(),
    registry,
    syncBrokerKeys,
    clearExpectedBrokerStart: () => {
      expectedBrokerStart = false;
    },
    startDockerEvents,
    close: () =>
      new Promise<void>((resolvePromise, rejectPromise) => {
        dockerEventWatcher?.stop();
        server.close((error) => (error ? rejectPromise(error) : resolvePromise()));
      })
  };
}

function composeErrorResponse(c: Context, error: unknown, fallbackMessage: string) {
  if (error instanceof ComposeCommandError) {
    return c.json({ status: 502, error: error.message, stderr: error.stderr }, 502);
  }
  const message = error instanceof Error ? error.message : fallbackMessage;
  return c.json({ status: 500, error: message }, 500);
}

const DEFAULT_SECRETS = new Set(Object.values(DEFAULT_KEYS).map((key) => key.secret));

function loadKeys(raw: string | undefined, requireExplicit = false): KeyRegistry {
  if (!raw) {
    if (requireExplicit) {
      throw new Error(
        "OPENCLAW_LOCAL_CONTROL_KEYS is required: this service can drive the host Docker daemon and refuses the built-in default key. Run `pnpm run setup` to generate a secret."
      );
    }
    return DEFAULT_KEYS;
  }
  let parsed: KeyRegistry;
  try {
    parsed = JSON.parse(raw) as KeyRegistry;
    if (!parsed || typeof parsed !== "object") {
      throw new Error("Invalid OPENCLAW_LOCAL_CONTROL_KEYS");
    }
  } catch (error) {
    throw new Error(
      `Failed to parse OPENCLAW_LOCAL_CONTROL_KEYS: ${error instanceof Error ? error.message : "unknown"}`
    );
  }
  if (requireExplicit && Object.values(parsed).some((key) => !key?.secret || DEFAULT_SECRETS.has(key.secret))) {
    throw new Error(
      "OPENCLAW_LOCAL_CONTROL_KEYS uses the default (or an empty) secret: refused. Run `pnpm run setup` to generate one."
    );
  }
  return parsed;
}

function authenticate(verifier: HmacVerifier, c: Context, rawBody: string): Response | null {
  const path = new URL(c.req.url).pathname;
  // @opengroow/hmac's HmacSigner (the real client Convex uses — see
  // instance_provisioning/local.ts) never includes a bodyHash for a
  // bodyless request (body === undefined). Every request this service
  // currently receives (POST /instances, DELETE /instances/:id) is
  // bodyless, so an empty raw body must verify the same way: as "no body",
  // not as a hash of the empty string, or the signatures never match.
  const body = rawBody.length > 0 ? rawBody : undefined;
  const result = verifier.verify({
    headers: c.req.raw.headers as unknown as Record<string, string | string[] | undefined>,
    method: c.req.method,
    path,
    body
  });
  if (!result.ok) {
    return c.json({ status: 401, error: result.error }, 401);
  }
  return null;
}
