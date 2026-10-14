import { beforeAll, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import { api } from "../_generated/api";
import schema from "../schema";
import { HmacSigner } from "@opengroow/hmac";
import { RUNTIME_OPENCLAW_EXEC_RESULT } from "@opengroow/protocol";
import type { Id } from "../_generated/dataModel";

const modules = import.meta.glob([
  "../_generated/**/*.ts",
  "../commands.ts",
  "../commands_batch_node.ts",
  "../commands_node.ts",
  "../events.ts",
  "../events_node.ts",
  "../health.ts",
  "../http.ts",
  "../instances.ts",
]);

const KEY_ID = "broker-test";
const SECRET = "broker-test-secret";
const INSTANCE_ID = "openclaw-instance-ingest";

beforeAll(() => {
  process.env.BROKER_KEY_ID = KEY_ID;
  process.env.BROKER_SECRET = SECRET;
});

let nonceCounter = 0;

type IngestEvent = { id: string; type: string; payload?: unknown; ts: number };

function signedIngestArgs(instanceId: string, event: IngestEvent) {
  const rawBody = JSON.stringify({ instanceId, event });
  const signer = new HmacSigner({ keyId: KEY_ID, secret: SECRET, prefix: "broker" });
  const headers = signer.sign("POST", "/events/ingest", rawBody);
  return {
    instanceId,
    event,
    rawBody,
    hmac: {
      keyId: headers["x-broker-key-id"],
      ts: headers["x-broker-ts"],
      nonce: headers["x-broker-nonce"],
      signature: headers["x-broker-signature"],
    },
  };
}

function anEvent(id?: string): IngestEvent {
  nonceCounter += 1;
  return { id: id ?? `evt-${nonceCounter}`, type: "runtime.custom", payload: { hello: "world" }, ts: Date.now() };
}

describe("events_node.ingest", () => {
  it("returns 401 when HMAC credentials are missing", async () => {
    const t = convexTest(schema, modules);
    const event = anEvent();
    const rawBody = JSON.stringify({ instanceId: INSTANCE_ID, event });

    const result = await t.action(api.events_node.ingest, {
      instanceId: INSTANCE_ID,
      event,
      rawBody,
    });

    expect(result).toMatchObject({ status: 401, ok: false });
  });

  it("stores the event carried by the signed body", async () => {
    const t = convexTest(schema, modules);
    const event = anEvent();

    const result = await t.action(api.events_node.ingest, signedIngestArgs(INSTANCE_ID, event));

    expect(result).toMatchObject({ status: 200, ok: true });
    await t.run(async (ctx) => {
      const stored = await ctx.db.query("events").collect();
      expect(stored).toHaveLength(1);
      expect(stored[0]).toMatchObject({ instanceId: INSTANCE_ID, eventId: event.id });
    });
  });

  it("persists the signed body, not arguments swapped alongside a captured signature", async () => {
    const t = convexTest(schema, modules);
    const signedEvent = anEvent();
    const args = signedIngestArgs(INSTANCE_ID, signedEvent);

    // The signature only covers rawBody: a caller replaying it with a
    // different instanceId/event must not get the tampered values persisted.
    const result = await t.action(api.events_node.ingest, {
      ...args,
      instanceId: "openclaw-instance-victim",
      event: { ...signedEvent, id: "evt-forged", payload: { hello: "tampered" } },
    });

    expect(result).toMatchObject({ status: 200, ok: true });
    await t.run(async (ctx) => {
      const stored = await ctx.db.query("events").collect();
      expect(stored).toHaveLength(1);
      expect(stored[0]).toMatchObject({
        instanceId: INSTANCE_ID,
        eventId: signedEvent.id,
        payload: { hello: "world" },
      });
    });
  });

  it("rejects a replay of the same signed request", async () => {
    const t = convexTest(schema, modules);
    const args = signedIngestArgs(INSTANCE_ID, anEvent());

    const first = await t.action(api.events_node.ingest, args);
    const replay = await t.action(api.events_node.ingest, args);

    expect(first).toMatchObject({ status: 200, ok: true });
    expect(replay).toMatchObject({ status: 401, ok: false });
  });

  it("rejects a tampered signature", async () => {
    const t = convexTest(schema, modules);
    const args = signedIngestArgs(INSTANCE_ID, anEvent());

    const result = await t.action(api.events_node.ingest, {
      ...args,
      hmac: { ...args.hmac, signature: "0".repeat(args.hmac.signature.length) },
    });

    expect(result).toMatchObject({ status: 401, ok: false });
    await t.run(async (ctx) => {
      expect(await ctx.db.query("events").collect()).toHaveLength(0);
    });
  });

  it("rejects a signed body that is not a valid ingest payload", async () => {
    const t = convexTest(schema, modules);
    const rawBody = JSON.stringify({ instanceId: INSTANCE_ID, event: { id: 42 } });
    const signer = new HmacSigner({ keyId: KEY_ID, secret: SECRET, prefix: "broker" });
    const headers = signer.sign("POST", "/events/ingest", rawBody);

    const result = await t.action(api.events_node.ingest, {
      instanceId: INSTANCE_ID,
      event: anEvent(),
      rawBody,
      hmac: {
        keyId: headers["x-broker-key-id"],
        ts: headers["x-broker-ts"],
        nonce: headers["x-broker-nonce"],
        signature: headers["x-broker-signature"],
      },
    });

    expect(result).toMatchObject({ status: 400, ok: false });
    await t.run(async (ctx) => {
      expect(await ctx.db.query("events").collect()).toHaveLength(0);
    });
  });

  it("schedules command-result signaling and stores only a normalized command id", async () => {
    vi.useFakeTimers();
    const t = convexTest(schema, modules);
    const commandId = await t.run(async (ctx) =>
      await ctx.db.insert("commands", {
        instanceId: INSTANCE_ID,
        type: "runtime.openclaw.exec",
        payload: {},
        status: "sent",
        attempts: 1,
        createdAt: Date.now(),
        deferred: true,
      }),
    );
    const event = {
      id: `runtime-result:${commandId}`,
      type: RUNTIME_OPENCLAW_EXEC_RESULT,
      payload: {
        commandId,
        instanceId: INSTANCE_ID,
        ok: true,
        data: { output: "ok", commandText: "openclaw --version", exitCode: 0 },
      },
      ts: Date.now(),
    };

    const result = await t.action(api.events_node.ingest, signedIngestArgs(INSTANCE_ID, event));
    expect(result).toMatchObject({ status: 200, ok: true });
    await t.run(async (ctx) => {
      expect(await ctx.db.query("commandResults").collect()).toHaveLength(0);
    });

    try {
      await t.finishAllScheduledFunctions(vi.runAllTimers);
      await t.run(async (ctx) => {
        const stored = await ctx.db.query("commandResults").unique();
        expect(stored?.commandId).toBe(commandId as Id<"commands">);
      });
    } finally {
      vi.useRealTimers();
    }
  });
});
