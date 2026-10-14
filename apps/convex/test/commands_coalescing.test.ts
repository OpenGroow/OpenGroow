import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import { api } from "../_generated/api";
import schema from "../schema";
import { MAX_COALESCE_BATCH } from "../commands";
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

const INSTANCE_ID = "openclaw-instance-coalesce";

beforeAll(() => {
  process.env.BROKER_URL = "http://broker.test";
  process.env.BROKER_KEY_ID = "broker-test";
  process.env.BROKER_SECRET = "broker-test-secret";
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 200 })));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function enqueue(
  t: ReturnType<typeof convexTest>,
  instanceId: string,
  index: number,
): Promise<Id<"commands">> {
  const result = await t.mutation(api.commands.enqueue, {
    instanceId,
    type: "runtime.openclaw.exec",
    payload: { index },
  });
  return result.commandId;
}

function batchBodies(): Array<{
  instanceId: string;
  commands: Array<{ id: Id<"commands">; payload: { index: number } }>;
}> {
  const fetchMock = vi.mocked(fetch);
  return fetchMock.mock.calls.flatMap(([url, init]) => {
    if (!String(url).endsWith("/broker/commands/batch")) return [];
    return [JSON.parse(String(init?.body))];
  });
}

describe("commands.enqueue → Broker batch dispatch", () => {
  it("dispatches new work when a legacy queued command has no deferred marker", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("commands", {
        instanceId: INSTANCE_ID,
        type: "runtime.workspace.file.write",
        payload: { filePath: "legacy.md" },
        status: "queued",
        attempts: 1,
        createdAt: Date.now() - 60_000,
      });
    });

    const commandId = await enqueue(t, INSTANCE_ID, 0);
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const fetchMock = vi.mocked(fetch);
    const dispatchedIds = fetchMock.mock.calls.flatMap(([url, init]) => {
      const body = JSON.parse(String(init?.body));
      return String(url).endsWith("/broker/commands/batch")
        ? body.commands.map((command: { id: Id<"commands"> }) => command.id)
        : [body.command.id as Id<"commands">];
    });
    expect(dispatchedIds).toEqual([commandId]);
  });

  it("coalesces a three-command burst into one ordered Broker request", async () => {
    const t = convexTest(schema, modules);
    const commandIds = [
      await enqueue(t, INSTANCE_ID, 0),
      await enqueue(t, INSTANCE_ID, 1),
      await enqueue(t, INSTANCE_ID, 2),
    ];

    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const batches = batchBodies();
    expect(batches).toHaveLength(1);
    expect(batches[0].instanceId).toBe(INSTANCE_ID);
    expect(batches[0].commands.map((command) => command.id)).toEqual(commandIds);
  });

  it("dispatches a bounded overflow exactly once per command", async () => {
    const t = convexTest(schema, modules);
    const commandIds: Id<"commands">[] = [];
    for (let index = 0; index < MAX_COALESCE_BATCH + 5; index++) {
      commandIds.push(await enqueue(t, INSTANCE_ID, index));
    }

    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const batches = batchBodies();
    expect(batches.every((batch) => batch.commands.length <= MAX_COALESCE_BATCH)).toBe(true);
    const dispatchedIds = batches.flatMap((batch) => batch.commands.map((command) => command.id));
    expect(dispatchedIds).toHaveLength(commandIds.length);
    expect(new Set(dispatchedIds)).toEqual(new Set(commandIds));
  });

  it("dispatches the single command just beyond the batch limit", async () => {
    const t = convexTest(schema, modules);
    const commandIds: Id<"commands">[] = [];
    for (let index = 0; index < MAX_COALESCE_BATCH + 1; index++) {
      commandIds.push(await enqueue(t, INSTANCE_ID, index));
    }

    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const fetchMock = vi.mocked(fetch);
    const dispatchedIds = fetchMock.mock.calls.flatMap(([url, init]) => {
      const body = JSON.parse(String(init?.body));
      return String(url).endsWith("/broker/commands/batch")
        ? body.commands.map((command: { id: Id<"commands"> }) => command.id)
        : [body.command.id as Id<"commands">];
    });
    expect(dispatchedIds).toHaveLength(commandIds.length);
    expect(new Set(dispatchedIds)).toEqual(new Set(commandIds));
  });

  it("never mixes commands from different Instances", async () => {
    const t = convexTest(schema, modules);
    const otherInstanceId = "openclaw-instance-other";
    const mine = [
      await enqueue(t, INSTANCE_ID, 0),
      await enqueue(t, INSTANCE_ID, 1),
    ];
    const other = [
      await enqueue(t, otherInstanceId, 2),
      await enqueue(t, otherInstanceId, 3),
    ];

    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const batches = batchBodies();
    expect(batches).toHaveLength(2);
    expect(batches.find((batch) => batch.instanceId === INSTANCE_ID)?.commands.map((command) => command.id)).toEqual(mine);
    expect(batches.find((batch) => batch.instanceId === otherInstanceId)?.commands.map((command) => command.id)).toEqual(other);
  });
});
