import { ConvexHttpClient } from "convex/browser";
import { anyApi } from "convex/server";
import type { FunctionReference } from "convex/server";
import type { Event } from "@opengroow/protocol";
import { HmacSigner } from "@opengroow/hmac";

const api = anyApi;
const internal = anyApi;

export type ConvexHealthAdapter = {
  health: () => Promise<HealthQueryResult>;
  ingestEvent: (instanceId: string, event: BrokerEvent) => Promise<void>;
  ackCommand: (instanceId: string, commandId: string) => Promise<void>;
};

type EnvBackedAdapterOptions = {
  baseUrl: string;
  token?: string;
  skipUrlCheck: boolean;
  hmacKeyId?: string;
  hmacSecret?: string;
};

const healthQuery = api.health.health;
const queryHealth = (client: ConvexHttpClient) => client.query(healthQuery, {});
const ingestEventAction = api.events_node.ingest;
const callIngestEvent = (
  client: ConvexHttpClient,
  instanceId: string,
  event: BrokerEvent,
  signer: HmacSigner | undefined,
) => {
  const rawBody = JSON.stringify({ instanceId, event });
  const args: Record<string, unknown> = { instanceId, event, rawBody };
  if (signer) {
    const hmacHeaders = signer.sign("POST", "/events/ingest", rawBody);
    args.hmac = {
      keyId: hmacHeaders["x-broker-key-id"],
      ts: hmacHeaders["x-broker-ts"],
      nonce: hmacHeaders["x-broker-nonce"],
      signature: hmacHeaders["x-broker-signature"],
    };
  }
  return client.action(ingestEventAction, args);
};
// commands.ack is an internal mutation, but the broker is a backend service
// authenticated with an admin token. At runtime it can call internal functions.
const ackMutation = internal.commands.ack as FunctionReference<"mutation">;
const callAckCommand = (client: ConvexHttpClient, instanceId: string, commandId: string) =>
  client.mutation(ackMutation, { instanceId, commandId });

type HealthQueryResult = Awaited<ReturnType<typeof queryHealth>>;
export type BrokerEvent = Event;

function createEnvBackedAdapter(options: EnvBackedAdapterOptions): ConvexHealthAdapter {
  const publicClient = new ConvexHttpClient(options.baseUrl, {
    skipConvexDeploymentUrlCheck: options.skipUrlCheck,
  });

  const adminClient = new ConvexHttpClient(options.baseUrl, {
    skipConvexDeploymentUrlCheck: options.skipUrlCheck,
  });

  const token = options.token?.trim();
  const hasAdminToken = configureAdminClient(adminClient, token);

  const signer = options.hmacKeyId && options.hmacSecret
    ? new HmacSigner({ keyId: options.hmacKeyId, secret: options.hmacSecret, prefix: "broker" })
    : undefined;

  return {
    async health() {
      return queryHealth(publicClient);
    },
    async ingestEvent(instanceId: string, event: BrokerEvent) {
      const result = await callIngestEvent(publicClient, instanceId, event, signer);
      if (result && typeof result === "object" && "ok" in result && !result.ok) {
        const status = "status" in result ? result.status : "unknown";
        const error = "error" in result ? result.error : "unknown error";
        throw new Error(`Convex event ingestion rejected: status=${status} error=${error}`);
      }
    },
    async ackCommand(instanceId: string, commandId: string) {
      if (!hasAdminToken) {
        return;
      }
      await callAckCommand(adminClient, instanceId, commandId);
    }
  };
}

function configureAdminClient(client: ConvexHttpClient, token: string | undefined): boolean {
  const trimmed = token?.trim();
  if (!trimmed) {
    return false;
  }

  const treatAsAdminKey = trimmed.includes("|");
  if (!treatAsAdminKey) {
    return false;
  }

  const withAdminAuth = client as ConvexHttpClient & {
    setAdminAuth?: (value: string) => void;
  };
  if (typeof withAdminAuth.setAdminAuth === "function") {
    withAdminAuth.setAdminAuth(trimmed);
    return true;
  }

  return false;
}

export function createConvexAdapterFromEnv(options?: {
  hmacKeyId?: string;
  hmacSecret?: string;
}): ConvexHealthAdapter {
  const baseUrl =
    process.env.CONVEX_URL ??
    process.env.NEXT_PUBLIC_CONVEX_URL ??
    "http://127.0.0.1:3210";
  const token = process.env.CONVEX_TOKEN;
  const skipUrlCheck = process.env.CONVEX_SKIP_URL_CHECK === "1";

  return createEnvBackedAdapter({
    baseUrl,
    token,
    skipUrlCheck,
    hmacKeyId: options?.hmacKeyId,
    hmacSecret: options?.hmacSecret,
  });
}
