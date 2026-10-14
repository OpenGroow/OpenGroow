import type { Hono, Context } from "hono";
import type { HmacVerifier } from "@opengroow/hmac";
import type { LocalControlConfig } from "./config.js";
import type { DockerRunner } from "./default-docker-runner.js";
import { InstanceRegistry, type KnownInstance } from "./registry.js";
import { readInstanceLogs, readInstanceStatus, type ComposeDeps } from "./instances.js";
import { readBrokerLogs, readBrokerStatus } from "./broker.js";

type InstanceLogTarget = "openclaw" | "broker";

export type ReadRoutesDeps = {
  registry: InstanceRegistry;
  composeDeps: ComposeDeps;
  dockerRunner: DockerRunner;
  config: LocalControlConfig;
  verifier: HmacVerifier;
  authenticate: (verifier: HmacVerifier, c: Context, rawBody: string) => Response | null;
  composeErrorResponse: (c: Context, error: unknown, fallbackMessage: string) => Response;
};

// Issue #308: list/logs/status — split out of local-control-server.ts (past
// its ~300-line split guideline, docs/CODE_CONVENTIONS.md) since these four
// read-only routes are one cohesive responsibility, distinct from the
// create/remove lifecycle routes that stay in that file.
export function registerReadRoutes(app: Hono, deps: ReadRoutesDeps): void {
  const { registry, composeDeps, dockerRunner, config, verifier, authenticate, composeErrorResponse } = deps;

  app.get("/instances", async (c) => {
    const authError = authenticate(verifier, c, "");
    if (authError) {
      return authError;
    }
    const jobs = registry.list().map(toJobPayload);
    return c.json({ status: 200, jobs }, 200);
  });

  app.get("/instances/:id", async (c) => {
    const authError = authenticate(verifier, c, "");
    if (authError) {
      return authError;
    }
    const instance = registry.get(c.req.param("id"));
    if (!instance) {
      return c.json({ status: 404, error: "Instance not found" }, 404);
    }
    return c.json({ status: 200, job: toJobPayload(instance) }, 200);
  });

  app.post("/instances/logs/:target", async (c) => {
    const dispatched = await dispatchTargetedRequest<{ port?: number; tail?: number; service?: string }>(
      c,
      verifier,
      authenticate
    );
    if (dispatched instanceof Response) {
      return dispatched;
    }
    const { target, payload } = dispatched;

    if (target === "broker") {
      try {
        const output = await readBrokerLogs(dockerRunner, config.brokerContainer, payload.tail);
        return c.json({ status: 200, output }, 200);
      } catch (error: unknown) {
        return composeErrorResponse(c, error, "Failed to read broker logs");
      }
    }

    const instance = resolveInstanceByPort(c, registry, payload.port);
    if (instance instanceof Response) {
      return instance;
    }
    try {
      const output = await readInstanceLogs(composeDeps, instance.id, {
        tail: payload.tail,
        service: payload.service
      });
      return c.json({ status: 200, output }, 200);
    } catch (error: unknown) {
      return composeErrorResponse(c, error, "Failed to read OpenClaw logs");
    }
  });

  app.post("/instances/status/:target", async (c) => {
    const dispatched = await dispatchTargetedRequest<{ port?: number }>(c, verifier, authenticate);
    if (dispatched instanceof Response) {
      return dispatched;
    }
    const { target, payload } = dispatched;

    if (target === "broker") {
      try {
        const output = await readBrokerStatus(dockerRunner, config.brokerContainer);
        return c.json({ status: 200, output }, 200);
      } catch (error: unknown) {
        return composeErrorResponse(c, error, "Failed to read broker status");
      }
    }

    const instance = resolveInstanceByPort(c, registry, payload.port);
    if (instance instanceof Response) {
      return instance;
    }
    try {
      const output = await readInstanceStatus(composeDeps, instance.id);
      return c.json({ status: 200, output }, 200);
    } catch (error: unknown) {
      return composeErrorResponse(c, error, "Failed to read OpenClaw status");
    }
  });
}

// Shaped to slot into Convex's InstanceJobPayload (sanitizeJob in
// instances_node.ts reads `id`/`status`/`runtimeStatus`/`openclaw.serverId`
// etc.) — a local instance is always "succeeded"/"linked" the moment it's
// in the registry, since createInstance only registers it after `docker
// compose up` has already succeeded (issue #305/#306).
function toJobPayload(instance: KnownInstance) {
  return {
    id: instance.id,
    status: "succeeded" as const,
    runtimeStatus: "linked" as const,
    runtimeReady: true,
    createdAt: instance.createdAt,
    openclaw: {
      serverId: instance.port,
      name: `openclaw-${instance.id}`,
      openClawId: instance.id,
      openClawKeyId: instance.keyId
    }
  };
}

// Shared by POST /instances/logs/:target and POST /instances/status/:target:
// both need the same auth → validate `:target` → parse JSON body sequence
// before branching on "openclaw" vs. "broker" — this is that shared prefix,
// parametrized on the JSON body's shape. Returns the parsed
// `{ target, payload }` on success, or the exact error Response to return
// (401/400) on failure, so callers propagate it with a single check.
async function dispatchTargetedRequest<Payload>(
  c: Context,
  verifier: HmacVerifier,
  authenticate: (verifier: HmacVerifier, c: Context, rawBody: string) => Response | null
): Promise<{ target: InstanceLogTarget; payload: Payload } | Response> {
  const rawBody = await c.req.text();
  const authError = authenticate(verifier, c, rawBody);
  if (authError) {
    return authError;
  }
  const target = c.req.param("target");
  if (target !== "openclaw" && target !== "broker") {
    return c.json({ status: 400, error: "Invalid target" }, 400);
  }
  try {
    const payload = (rawBody.length ? JSON.parse(rawBody) : {}) as Payload;
    return { target, payload };
  } catch {
    return c.json({ status: 400, error: "Invalid JSON body" }, 400);
  }
}

// Shared by the logs/status "openclaw" branches: resolves the port the
// dashboard passed as `serverId` back to the instance it belongs to, or
// returns the right error Response directly so callers can propagate it
// with a single check.
function resolveInstanceByPort(
  c: Context,
  registry: InstanceRegistry,
  port: number | undefined
): KnownInstance | Response {
  if (port === undefined || !Number.isFinite(port)) {
    return c.json({ status: 400, error: "port is required" }, 400);
  }
  const instance = registry.findByPort(port);
  if (!instance) {
    return c.json({ status: 404, error: "Instance not found" }, 404);
  }
  return instance;
}
