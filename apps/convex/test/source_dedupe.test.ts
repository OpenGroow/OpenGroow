import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import { api, internal } from "../_generated/api";
import schema from "../schema";
import { insertInstance } from "./instance_fixture";

const modules = {
  "../_generated/api.ts": () => import("../_generated/api.js"),
  "../instance_ownership.ts": () => import("../instance_ownership.js"),
  "../instances.ts": () => import("../instances.js"),
  "../source_dedupe.ts": () => import("../source_dedupe.js"),
  "../sources.ts": () => import("../sources.js"),
};

const INSTANCE = "dedupe-instance";
const OWNER = { name: "Owner", email: "owner@example.com", tokenIdentifier: "test|dedupe", subject: "owner-dedupe" };
const T0 = 1_800_000_000_000;
const DAY = 86_400_000;

async function seed(t: ReturnType<typeof convexTest>) {
  await t.run((ctx) => insertInstance(ctx, {
    jobId: "job-dedupe", status: "running", runtimeStatus: "linked", runtimeReady: true,
    createdAt: new Date(T0).toISOString(), openclawId: INSTANCE, updatedAt: new Date(T0).toISOString(), userId: OWNER.subject,
  }));
}

const post = (t: ReturnType<typeof convexTest>, origin: string, capturedAt: number, extra: Record<string, unknown> = {}) =>
  t.run((ctx) => ctx.db.insert("sources", {
    instanceId: INSTANCE, ownerId: OWNER.subject, templateId: "@opengroow/engagement", sourceId: "instagram-reel", label: "Reel", family: "social-video",
    status: "ready", origin, capturedAt, createdAt: capturedAt, marketing: { summary: "s" }, analysis: {}, ...extra,
  }));

describe("source dedupe", () => {
  it("reports each post captured twice, keeping the oldest, and deletes nothing", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    const older = await post(t, "https://www.instagram.com/reel/AAA/?srtk=1", T0);
    const newer = await post(t, "https://www.instagram.com/p/AAA/", T0 + 4 * DAY);
    await post(t, "https://www.instagram.com/reel/BBB/", T0);

    const report = await t.query(internal.source_dedupe.report, { instanceId: INSTANCE });

    expect(report).toMatchObject({ posts: 1, toRemove: 1 });
    expect(report.groups[0]!.keep.id).toBe(older);
    expect(report.groups[0]!.remove.map((entry) => entry.id)).toEqual([newer]);
    expect(await t.run((ctx) => ctx.db.query("sources").collect())).toHaveLength(3);
  });

  it("keeps the copy that already led to a Mission, and never removes one that did", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    const missionId = await t.run((ctx) => ctx.db.insert("missions", {
      ownerId: OWNER.subject, instanceId: INSTANCE, templateId: "@opengroow/openmontage-agent", type: "create_reel", payload: {}, status: "done", createdAt: T0, updatedAt: T0,
    }));
    const oldest = await post(t, "https://www.instagram.com/reel/AAA/", T0);
    const produced = await post(t, "https://www.instagram.com/reel/AAA/", T0 + DAY, { productionMissionId: missionId });
    const another = await post(t, "https://www.instagram.com/reel/AAA/", T0 + 2 * DAY, { productionMissionId: missionId });

    const report = await t.query(internal.source_dedupe.report, { instanceId: INSTANCE });

    expect(report.groups[0]!.keep.id).toBe(produced);
    expect(report.groups[0]!.remove.map((entry) => entry.id)).toEqual([oldest]);
    expect(report.groups[0]!.remove.map((entry) => entry.id)).not.toContain(another);
  });

  it("refuses to delete without confirm, then deletes the duplicates and their thumbnails", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    const older = await post(t, "https://www.instagram.com/reel/AAA/", T0);
    const storageId = await t.run((ctx) => ctx.storage.store(new Blob([new Uint8Array([1])], { type: "image/jpeg" })));
    const newer = await post(t, "https://www.instagram.com/reel/AAA/", T0 + DAY, { thumbnailStorageId: storageId });

    await expect(t.mutation(internal.source_dedupe.removeDuplicates, { instanceId: INSTANCE, confirm: false })).rejects.toThrow("confirm: true");
    expect(await t.run((ctx) => ctx.db.get(newer))).not.toBeNull();

    expect(await t.mutation(internal.source_dedupe.removeDuplicates, { instanceId: INSTANCE, confirm: true })).toEqual({ removed: 1 });
    expect(await t.run((ctx) => ctx.db.get(older))).not.toBeNull();
    expect(await t.run((ctx) => ctx.db.get(newer))).toBeNull();
    expect(await t.run((ctx) => ctx.storage.get(storageId))).toBeNull();
  });

  it("gives the Sources written before originKey existed their key", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    const id = await post(t, "https://www.instagram.com/reel/AAA/?x=1", T0);
    await t.mutation(internal.source_dedupe.backfillOriginKeys, {});
    expect((await t.run((ctx) => ctx.db.get(id)))?.originKey).toBe("instagram.com/p/AAA");
  });

  it("deleting a Source from the page also deletes its stored thumbnail", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    const storageId = await t.run((ctx) => ctx.storage.store(new Blob([new Uint8Array([1])], { type: "image/jpeg" })));
    const id = await post(t, "https://www.instagram.com/reel/AAA/", T0, { thumbnailStorageId: storageId });

    await t.withIdentity(OWNER).mutation(api.sources.removeMany, { sourceIds: [id] });

    expect(await t.run((ctx) => ctx.db.get(id))).toBeNull();
    expect(await t.run((ctx) => ctx.storage.get(storageId))).toBeNull();
  });
});

describe("sources.counts", () => {
  it("counts every Source by status, and the two tabs, whatever has been loaded", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    const scoring = { productFit: 0.75, replicability: 0.75, creativeStrength: 0.75 };
    await post(t, "https://www.instagram.com/reel/S1/", T0, { scoring });
    await post(t, "https://www.instagram.com/reel/S2/", T0 + 1, { scoring });
    await post(t, "https://www.instagram.com/reel/P1/", T0 + 2, { scoring, selectedAt: T0 }); // picked: on neither tab
    await post(t, "https://www.instagram.com/reel/N1/", T0 + 3); // ready, not scored: Other
    await post(t, "https://www.instagram.com/reel/F1/", T0 + 4, { status: "failed" });
    await post(t, "https://www.instagram.com/reel/U1/", T0 + 5, { status: "unavailable" });
    await post(t, "https://www.instagram.com/reel/G1/", T0 + 6, { status: "processing" });

    const counts = await t.withIdentity(OWNER).query(api.sources.counts, { instanceId: INSTANCE });

    expect(counts).toEqual({ total: 7, processing: 1, ready: 4, failed: 1, unavailable: 1, scored: 2, other: 4, capped: false });
  });

  it("counts nothing for someone who does not own the Instance", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    await post(t, "https://www.instagram.com/reel/S1/", T0);
    const counts = await t.withIdentity({ ...OWNER, subject: "stranger", tokenIdentifier: "test|stranger" }).query(api.sources.counts, { instanceId: INSTANCE });
    expect(counts.total).toBe(0);
  });
});
