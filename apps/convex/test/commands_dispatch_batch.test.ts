import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import { api } from "../_generated/api";
import schema from "../schema";
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
  "../project_provider_operations.ts",
  "../runtime_commands_node.ts",
  "../runtime_commands_node_parsers.ts",
]);

const INSTANCE_ID = "openclaw-instance-batch";

beforeAll(() => {
  process.env.BROKER_URL = "http://broker.test";
  process.env.BROKER_KEY_ID = "broker-test";
  process.env.BROKER_SECRET = "broker-test-secret";
});

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function enqueueBurst(
  t: ReturnType<typeof convexTest>,
  count: number,
): Promise<Id<"commands">[]> {
  const ids: Id<"commands">[] = [];
  for (let index = 0; index < count; index++) {
    const result = await t.mutation(api.commands.enqueue, {
      instanceId: INSTANCE_ID,
      type: "runtime.openclaw.exec",
      payload: { index },
    });
    ids.push(result.commandId);
  }
  return ids;
}

function requestLog() {
  return vi.mocked(fetch).mock.calls.map(([url, init]) => ({
    path: new URL(String(url)).pathname,
    body: JSON.parse(String(init?.body)) as {
      command?: { id: Id<"commands"> };
      commands?: Array<{ id: Id<"commands"> }>;
    },
  }));
}

describe("commands.enqueue → Broker retry and fallback", () => {
  it("dispatches an interactive runtime action before the scheduler runs", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 200 })));
    const t = convexTest(schema, modules);

    const result = await t.action(api.runtime_commands_node.requestOpenClawExec, {
      instanceId: INSTANCE_ID,
      commandText: "openclaw --version",
    });

    expect(result.accepted).toBe(true);
    expect(requestLog()).toHaveLength(1);
    expect(requestLog()[0].path).toBe("/broker/commands");
    expect(requestLog()[0].body.command?.id).toBe(result.commandId);
  });

  it("surfaces an interactive delivery failure without retrying in the background", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    }));
    const t = convexTest(schema, modules);

    const result = await t.action(api.project_provider_operations.configureAiProvider, {
      instanceId: INSTANCE_ID,
      provider: "openai",
      model: "gpt-5",
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    expect(result).toEqual({
      ok: false,
      output: "",
      error: "Runtime command dispatch failed",
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("falls back to one individual request per command when the batch endpoint is missing", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) =>
      new Response("", { status: String(input).endsWith("/broker/commands/batch") ? 404 : 200 }),
    ));
    const t = convexTest(schema, modules);
    const commandIds = await enqueueBurst(t, 3);

    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const requests = requestLog();
    expect(requests.filter((request) => request.path.endsWith("/batch"))).toHaveLength(1);
    const individualIds = requests
      .filter((request) => request.path.endsWith("/commands"))
      .map((request) => request.body.command?.id);
    expect(individualIds).toHaveLength(commandIds.length);
    expect(new Set(individualIds)).toEqual(new Set(commandIds));
  });

  it("retries only the command rejected by a trustworthy 207 response", async () => {
    let failedId: Id<"commands"> | undefined;
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      if (String(input).endsWith("/broker/commands/batch")) {
        return new Response(JSON.stringify({ failed: [failedId] }), { status: 207 });
      }
      return new Response("", { status: 200 });
    }));
    const t = convexTest(schema, modules);
    const commandIds = await enqueueBurst(t, 2);
    [failedId] = commandIds;

    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const individualIds = requestLog()
      .filter((request) => request.path.endsWith("/commands"))
      .map((request) => request.body.command?.id);
    expect(individualIds).toEqual([failedId]);
  });

  it("retries the whole batch when a 207 response cannot identify the failures", async () => {
    let batchCalls = 0;
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      if (String(input).endsWith("/broker/commands/batch")) {
        batchCalls += 1;
        return batchCalls === 1
          ? new Response("not-json", { status: 207 })
          : new Response("", { status: 200 });
      }
      return new Response("", { status: 200 });
    }));
    const t = convexTest(schema, modules);
    const commandIds = await enqueueBurst(t, 2);

    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const batches = requestLog().filter((request) => request.path.endsWith("/batch"));
    expect(batches).toHaveLength(2);
    expect(batches[1].body.commands?.map((command) => command.id)).toEqual(commandIds);
  });
});
