import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import { api } from "../_generated/api";
import schema from "../schema";
import { insertInstance } from "./instance_fixture";

const modules = {
  "../_generated/api.ts": () => import("../_generated/api.js"),
  "../run_trace_list.ts": () => import("../run_trace_list.js"),
};

const ALICE = { name: "Alice", email: "alice@example.com", tokenIdentifier: "test|alice", subject: "alice" };
const BOB = { name: "Bob", email: "bob@example.com", tokenIdentifier: "test|bob", subject: "bob" };

type T = ReturnType<typeof convexTest>;

async function seedInstance(t: T, openclawId: string, owner: typeof ALICE, displayName: string) {
  await t.run((ctx) =>
    insertInstance(ctx, {
      jobId: `job-${openclawId}`,
      status: "running",
      runtimeStatus: "linked",
      runtimeReady: true,
      createdAt: new Date(0).toISOString(),
      openclawId,
      updatedAt: new Date(0).toISOString(),
      userId: owner.subject,
      displayName,
    }),
  );
}

async function seedMissionRun(
  t: T,
  o: {
    instanceId: string;
    owner: typeof ALICE;
    templateId?: string;
    status?: "pending" | "completed" | "failed";
    createdAt: number;
    type?: string;
  },
) {
  return await t.run(async (ctx) => {
    const templateId = o.templateId ?? "article-writer";
    const missionId = await ctx.db.insert("missions", {
      ownerId: o.owner.subject,
      instanceId: o.instanceId,
      templateId,
      type: o.type ?? "create_article",
      payload: {},
      status: "todo",
      createdAt: o.createdAt,
      updatedAt: o.createdAt,
    });
    return await ctx.db.insert("runs", {
      missionId,
      ownerId: o.owner.subject,
      instanceId: o.instanceId,
      templateId,
      agentName: templateId,
      sessionKey: "secret-session-key",
      status: o.status ?? "completed",
      createdAt: o.createdAt,
      completedAt: o.createdAt + 5000,
      updatedAt: o.createdAt,
    });
  });
}

async function seedJobRun(t: T, o: { instanceId: string; owner: typeof ALICE; createdAt: number }) {
  return await t.run(async (ctx) => {
    const jobId = await ctx.db.insert("jobs", {
      ownerId: o.owner.subject,
      instanceId: o.instanceId,
      templateId: "scorer",
      type: "source_scoring",
      state: "active",
      config: {},
      runtime: {},
      unit: "daily",
      hour: 0,
      minute: 0,
      timezone: "UTC",
      nextRunAt: 0,
      createdAt: o.createdAt,
      updatedAt: o.createdAt,
    } as never);
    return await ctx.db.insert("runs", {
      jobId,
      ownerId: o.owner.subject,
      instanceId: o.instanceId,
      templateId: "scorer",
      agentName: "scorer",
      sessionKey: "secret-session-key",
      status: "completed",
      createdAt: o.createdAt,
      updatedAt: o.createdAt,
    });
  });
}

const args = (limit: number, extra: Record<string, unknown> = {}) => ({ limit, ...extra });

describe("run_trace_list.listRecent", () => {
  it("lists Mission and Job Runs of every owned Project, newest first, and never another owner's", async () => {
    const t = convexTest(schema, modules);
    await seedInstance(t, "inst-a", ALICE, "Alpha");
    await seedInstance(t, "inst-b", ALICE, "Beta");
    await seedInstance(t, "inst-c", BOB, "Gamma");
    const oldest = await seedMissionRun(t, { instanceId: "inst-a", owner: ALICE, createdAt: 1000 });
    const job = await seedJobRun(t, { instanceId: "inst-b", owner: ALICE, createdAt: 3000 });
    const newest = await seedMissionRun(t, { instanceId: "inst-b", owner: ALICE, createdAt: 4000 });
    await seedMissionRun(t, { instanceId: "inst-c", owner: BOB, createdAt: 5000 });

    const result = await t.withIdentity(ALICE).query(api.run_trace_list.listRecent, args(10));

    expect(result.items.map((r) => r.runId)).toEqual([newest, job, oldest]);
    expect(result.items[0]).toMatchObject({
      kind: "mission",
      name: "create_article",
      projectName: "Beta",
      instanceId: "inst-b",
      completedAt: 9000,
    });
    expect(result.items[1]).toMatchObject({ kind: "job", name: "source_scoring" });
    expect(JSON.stringify(result)).not.toContain("secret-session-key");
    expect(result.nextCursor).toBeNull();
  });

  it("paginates with a cursor, keeping runs created at the same instant", async () => {
    const t = convexTest(schema, modules);
    await seedInstance(t, "inst-a", ALICE, "Alpha");
    await seedInstance(t, "inst-b", ALICE, "Beta");
    const ids = [
      await seedMissionRun(t, { instanceId: "inst-a", owner: ALICE, createdAt: 1000 }),
      await seedMissionRun(t, { instanceId: "inst-b", owner: ALICE, createdAt: 2000 }),
      await seedMissionRun(t, { instanceId: "inst-a", owner: ALICE, createdAt: 2000 }),
      await seedMissionRun(t, { instanceId: "inst-b", owner: ALICE, createdAt: 3000 }),
      await seedMissionRun(t, { instanceId: "inst-a", owner: ALICE, createdAt: 3000 }),
    ];
    const seen: string[] = [];
    const created: number[] = [];
    let cursor: { createdAt: number; creationTime: number } | null = null;
    for (let i = 0; i < 5; i++) {
      const page: Awaited<ReturnType<ReturnType<T["withIdentity"]>["query"]>> = await t
        .withIdentity(ALICE)
        .query(api.run_trace_list.listRecent, args(2, cursor ? { cursor } : {}));
      for (const item of page.items) {
        seen.push(item.runId);
        created.push(item.createdAt);
      }
      cursor = page.nextCursor;
      if (!cursor) break;
    }
    expect(seen).toHaveLength(5);
    expect([...seen].sort()).toEqual([...ids].sort());
    expect(created).toEqual([3000, 3000, 2000, 2000, 1000]);
  });

  it("combines the Project, Agent and Status filters", async () => {
    const t = convexTest(schema, modules);
    await seedInstance(t, "inst-a", ALICE, "Alpha");
    await seedInstance(t, "inst-b", ALICE, "Beta");
    await seedMissionRun(t, { instanceId: "inst-a", owner: ALICE, createdAt: 1000, templateId: "writer", status: "failed" });
    const target = await seedMissionRun(t, { instanceId: "inst-b", owner: ALICE, createdAt: 2000, templateId: "writer", status: "failed" });
    await seedMissionRun(t, { instanceId: "inst-b", owner: ALICE, createdAt: 3000, templateId: "writer", status: "completed" });
    await seedMissionRun(t, { instanceId: "inst-b", owner: ALICE, createdAt: 4000, templateId: "editor", status: "failed" });
    const q = t.withIdentity(ALICE);

    const combined = await q.query(
      api.run_trace_list.listRecent,
      args(10, { instanceId: "inst-b", templateId: "writer", status: "failed" }),
    );
    expect(combined.items.map((r) => r.runId)).toEqual([target]);
    expect((await q.query(api.run_trace_list.listRecent, args(10, { status: "failed" }))).items).toHaveLength(3);
    expect((await q.query(api.run_trace_list.listRecent, args(10, { templateId: "writer" }))).items).toHaveLength(3);
  });

  it("returns nothing for a Project the caller does not own, and lists Runs without a session", async () => {
    const t = convexTest(schema, modules);
    await seedInstance(t, "inst-a", ALICE, "Alpha");
    await seedMissionRun(t, { instanceId: "inst-a", owner: ALICE, createdAt: 1000, status: "pending" });
    const asBob = await t.withIdentity(BOB).query(api.run_trace_list.listRecent, args(10, { instanceId: "inst-a" }));
    expect(asBob.items).toEqual([]);
    const asAlice = await t.withIdentity(ALICE).query(api.run_trace_list.listRecent, args(10));
    expect(asAlice.items).toHaveLength(1);
    expect(asAlice.items[0]?.status).toBe("pending");
  });

  it("limits the Agent filter options to the selected Project", async () => {
    const t = convexTest(schema, modules);
    await seedInstance(t, "inst-a", ALICE, "Alpha");
    await seedInstance(t, "inst-b", ALICE, "Beta");
    await t.run(async (ctx) => {
      for (const [instanceId, templateId] of [["inst-a", "writer"], ["inst-b", "scorer"]] as const) {
        await ctx.db.insert("projectAgents", { instanceId, templateId, status: "active", mcpServerKeys: [], createdAt: 0, updatedAt: 0 } as never);
      }
    });
    const asAlice = t.withIdentity(ALICE);
    const all = await asAlice.query(api.run_trace_list.filterOptions, {});
    expect(all.agents.map((a) => a.templateId).sort()).toEqual(["scorer", "writer"]);
    const one = await asAlice.query(api.run_trace_list.filterOptions, { instanceId: "inst-a" });
    expect(one.agents.map((a) => a.templateId)).toEqual(["writer"]);
    expect(one.projects).toHaveLength(2);
    const foreign = await asAlice.query(api.run_trace_list.filterOptions, { instanceId: "inst-zzz" });
    expect(foreign.agents).toEqual([]);
  });

  it("requires authentication", async () => {
    const t = convexTest(schema, modules);
    await expect(t.query(api.run_trace_list.listRecent, args(10))).rejects.toThrow(/Authentication/);
  });
});
