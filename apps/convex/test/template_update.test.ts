import { insertInstance } from "./instance_fixture";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import { api, internal } from "../_generated/api";
import schema from "../schema";
import type { Doc, Id } from "../_generated/dataModel";
import {
  readHostedClawPackageFixture,
  withFile,
  type PackageFile,
} from "../../../packages/agent-templates/src/__fixtures__/claw-package";

// Explicit Template updates (#669): a newer version is offered, shown as a plan, and applied only on confirmation.
const modules = {
  "../_generated/api.ts": () => import("../_generated/api.js"),
  "../commands.ts": () => import("../commands.js"),
  "../commands_node.ts": () => import("../commands_node.js"),
  "../connect_tickets.ts": () => import("../connect_tickets.js"),
  "../connect_tickets_node.ts": () => import("../connect_tickets_node.js"),
  "../events.ts": () => import("../events.js"),
  "../health.ts": () => import("../health.js"),
  "../http.ts": () => import("../http.js"),
  "../instances.ts": () => import("../instances.js"),
  "../instances_node.ts": () => import("../instances_node.js"),
  "../missions.ts": () => import("../missions.js"),
  "../missions_node.ts": () => import("../missions_node.js"),
  "../runs.ts": () => import("../runs.js"),
  "../project_agents.ts": () => import("../project_agents.js"),
  "../project_agents_node.ts": () => import("../project_agents_node.js"),
  "../project_templates.ts": () => import("../project_templates.js"),
  "../template_mcp_overrides.ts": () => import("../template_mcp_overrides.js"),
  "../template_install_local.ts": () => import("../template_install_local.js"),
  "../runtime_commands_node.ts": () => import("../runtime_commands_node.js"),
  "../mission_dispatcher.ts": () => import("../mission_dispatcher.js"),
  "../mission_dispatcher_node.ts": () => import("../mission_dispatcher_node.js"),
};

const PROJECT = "openclaw-project-upd";
const OWNER = { name: "Owner", email: "o@e.com", tokenIdentifier: "test|upd", subject: "owner-upd" };
const INTRUDER = { name: "X", email: "x@e.com", tokenIdentifier: "test|x-upd", subject: "intruder-upd" };

const seoV1 = (): PackageFile[] => readHostedClawPackageFixture("seo");

const setVersion = (files: PackageFile[], version: string) =>
  withFile(files, "package.json", JSON.stringify({ name: "@acme/seo", version, openclaw: { claw: "CLAW.md" } }));

/** v2 renames the approve action and points the MCP server to another host. */
function seoV2(): PackageFile[] {
  const profile = seoV1().find((f) => f.path === "profiles/opengroow.yml")!.content;
  const changed = profile.replace("/articles/{id}/approve", "/articles/{id}/accept").replace("label: Approve", "label: Accept");
  expect(changed).not.toBe(profile);
  return setVersion(withFile(seoV1(), "profiles/opengroow.yml", changed), "0.0.2");
}

async function seedInstance(t: ReturnType<typeof convexTest>, openclawId: string) {
  const now = new Date().toISOString();
  await t.run(async (ctx) => {
    await insertInstance(ctx, {
      jobId: `job-${openclawId}`,
      status: "running",
      runtimeStatus: "linked",
      runtimeReady: true,
      createdAt: now,
      openclawId,
      updatedAt: now,
      userId: OWNER.subject,
    });
  });
}

const missionDoc = (t: ReturnType<typeof convexTest>, id: Id<"missions">) =>
  t.run(async (ctx) => (await ctx.db.get(id)) as Doc<"missions">);

describe("Explicit Template updates (#669)", () => {
  let t: ReturnType<typeof convexTest>;
  let as: ReturnType<ReturnType<typeof convexTest>["withIdentity"]>;

  beforeEach(async () => {
    // The Instance reconciliation scheduled by a confirmed update is out of scope here: never advance timers.
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    t = convexTest(schema, modules);
    await seedInstance(t, PROJECT);
    const ts = Date.now();
    await t.run(async (ctx) => {
      await ctx.db.insert("projectAgents", {
        instanceId: PROJECT,
        templateId: "@acme/seo",
        status: "active",
        workspaceKey: "ws-upd",
        openclawAgentName: "seo",
        mcpServerKeys: [],
        config: { seoProjectId: "proj-upd", apiKey: "key-upd" },
        createdAt: ts,
        updatedAt: ts,
      });
    });
    as = t.withIdentity(OWNER);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const install = (files: PackageFile[]) => as.mutation(api.project_templates.install, { projectId: PROJECT, files });
  const offer = (files: PackageFile[]) => t.mutation(internal.template_install_local.offerUpdate, { projectId: PROJECT, files });
  const updates = () => as.query(api.project_templates.updates, { projectId: PROJECT });
  const createMission = async () =>
    (
      await as.mutation(api.missions.create, {
        instanceId: PROJECT,
        templateId: "@acme/seo",
        type: "create_article",
        payload: { keyword: "octopus" },
      })
    ).missionId;
  const toValidate = (missionId: Id<"missions">) =>
    t.run(async (ctx) => {
      await ctx.db.patch(missionId, {
        status: "to_validate",
        lastResult: {
          status: "needs_human_review",
          summary: "ready",
          reviewQuestions: [],
          artifact: { kind: "markdown", external: { service: "article-mcp", id: "art-1" }, metadata: {} },
        } as Doc<"missions">["lastResult"],
      });
    });
  const approveLabel = async (missionId: Id<"missions">) =>
    (await as.action(api.missions_node.getReview, { missionId })).actions.find((a) => a.key === "approve")?.label;

  it("shows nothing when no newer version is offered", async () => {
    await install(seoV1());
    expect(await updates()).toEqual([]);
  });

  it("shows an offered newer version with its plan, without changing the installed one", async () => {
    await install(seoV1());
    await offer(seoV2());

    const [update] = await updates();
    expect(update).toMatchObject({ templateId: "@acme/seo", currentVersion: "0.0.1", availableVersion: "0.0.2" });
    expect(update!.plan).toMatchObject({ fromVersion: "0.0.1", toVersion: "0.0.2" });

    // Nothing changed: the current version, and what a new Mission pins, are still 0.0.1.
    const missionId = await createMission();
    expect((await missionDoc(t, missionId)).templateVersion).toBe("0.0.1");
    const origins = await as.query(api.project_templates.origins, { projectId: PROJECT });
    expect(origins.find((o) => o.templateId === "@acme/seo")?.version).toBe("0.0.1");
  });

  it("refuses an offer that is not newer than the installed version, or for a Template not installed", async () => {
    await expect(offer(seoV2())).rejects.toThrow(/not installed/);
    await install(setVersion(seoV1(), "0.0.5"));
    await expect(offer(seoV2())).rejects.toThrow(/newer/);
  });

  it("lists the plan's removed Mission types a Schedule still uses", async () => {
    await install(seoV1());
    // v2 drops the internal_linking Mission type (the profile lines of its declaration).
    const lines = seoV1().find((f) => f.path === "profiles/opengroow.yml")!.content.split("\n");
    const start = lines.findIndex((l) => l === "  - type: internal_linking");
    const end = lines.findIndex((l) => l === "generativeMcpCall:");
    const jobs = lines.findIndex((l) => l === "  internal_linking:");
    const kept = [...lines.slice(0, start), ...lines.slice(end, jobs)].join("\n") + "\n";
    const files = setVersion(withFile(seoV1(), "profiles/opengroow.yml", kept), "0.0.2");
    await t.run(async (ctx) => {
      await ctx.db.insert("schedules", {
        ownerId: OWNER.subject,
        instanceId: PROJECT,
        templateId: "@acme/seo",
        type: "internal_linking",
        payload: {},
        unit: "daily",
        hour: 9,
        minute: 0,
        timezone: "UTC",
        status: "active",
        nextRunAt: Date.now() + 1000,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });
    await offer(files);
    const [update] = await updates();
    expect(update!.plan.removedMissionTypesInUse).toEqual([{ type: "internal_linking", schedules: 1 }]);
  });

  it("applies the update only on confirmation; an in-flight Mission in to_validate keeps its version", async () => {
    await install(seoV1());
    const inFlight = await createMission();
    await toValidate(inFlight);
    await offer(seoV2());
    expect(await approveLabel(inFlight)).toBe("Approve");

    await as.mutation(api.project_templates.applyUpdate, { projectId: PROJECT, templateId: "@acme/seo", version: "0.0.2" });

    expect(await updates()).toEqual([]);
    expect((await missionDoc(t, inFlight)).templateVersion).toBe("0.0.1");
    expect(await approveLabel(inFlight)).toBe("Approve");
    const fresh = await createMission();
    expect((await missionDoc(t, fresh)).templateVersion).toBe("0.0.2");
    await toValidate(fresh);
    expect(await approveLabel(fresh)).toBe("Accept");
    // The superseded version is kept while the Mission uses it.
    const usage = await as.query(api.project_templates.versionUsage, { projectId: PROJECT, templateId: "@acme/seo" });
    expect(usage).toEqual(
      expect.arrayContaining([
        { version: "0.0.1", current: false, inUse: true, removable: false },
        { version: "0.0.2", current: true, inUse: true, removable: false },
      ]),
    );
  });

  it("does not apply a version that was not offered, nor for a Project the caller cannot access", async () => {
    await install(seoV1());
    await offer(seoV2());
    await expect(
      as.mutation(api.project_templates.applyUpdate, { projectId: PROJECT, templateId: "@acme/seo", version: "9.9.9" }),
    ).rejects.toThrow(/offered/);
    await expect(
      t
        .withIdentity(INTRUDER)
        .mutation(api.project_templates.applyUpdate, { projectId: PROJECT, templateId: "@acme/seo", version: "0.0.2" }),
    ).rejects.toThrow();
    expect(await t.withIdentity(INTRUDER).query(api.project_templates.updates, { projectId: PROJECT })).toEqual([]);
  });

  it("refuses a non-owner applying the update and leaves the offer pending", async () => {
    await install(seoV1());
    await offer(seoV2());
    await expect(
      t
        .withIdentity(INTRUDER)
        .mutation(api.project_templates.applyUpdate, { projectId: PROJECT, templateId: "@acme/seo", version: "0.0.2" }),
    ).rejects.toThrow(/not accessible/);
    expect((await updates()).map((u) => u.availableVersion)).toEqual(["0.0.2"]);
    const current = await t.run(async (ctx) =>
      (await ctx.db.query("installedTemplates").collect()).filter((d) => d.current).map((d) => d.version),
    );
    expect(current).toEqual(["0.0.1"]);
  });

  it("a later offer replaces the previous one", async () => {
    await install(seoV1());
    await offer(seoV2());
    await offer(setVersion(seoV1(), "0.0.3"));
    const list = await updates();
    expect(list.map((u) => u.availableVersion)).toEqual(["0.0.3"]);
  });
});

// The public install is self-host only (#707): these tests install packages the way a self-hosted owner does.
beforeEach(() => {
  vi.stubEnv("IS_SELF_HOST", "1");
});
afterEach(() => {
  vi.unstubAllEnvs();
});
