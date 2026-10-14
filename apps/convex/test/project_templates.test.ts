import { insertInstance } from "./instance_fixture";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { join } from "node:path";
import { convexTest } from "convex-test";
import { createInMemoryTemplateRegistry } from "@opengroow/agent-templates/registry";
import type { AgentTemplate } from "@opengroow/agent-templates";
import { api } from "../_generated/api";
import schema from "../schema";
import { readHostedClawPackageFixture, withFile } from "../../../packages/agent-templates/src/__fixtures__/claw-package";
import { readPackageFolder } from "../../../packages/agent-templates/src/package-folder";
import { fixtureTemplate } from "./helpers/template_registry.helpers";
import { getProjectManifest, listProjectManifests } from "../project_templates";

const modules = {
  "../_generated/api.ts": () => import("../_generated/api.js"),
  "../project_templates.ts": () => import("../project_templates.js"),
};

const hello = fixtureTemplate("hello");
const fixture = (id: string, visibility: "production" | "development" = "production"): AgentTemplate => ({
  ...hello,
  manifest: { ...hello.manifest, id, name: `Fixture ${id}`, visibility },
});

const registry = createInMemoryTemplateRegistry([
  { projectId: "p1", template: fixture("a") },
  { projectId: "p1", template: fixture("dev", "development") },
  { projectId: "p2", template: fixture("b") },
]);

describe("listProjectManifests", () => {
  it("returns the manifests of the Project's Templates only", async () => {
    const manifests = await listProjectManifests(registry, "p1", { includeDevelopment: false });
    expect(manifests.map((m) => m.id)).toEqual(["a"]);
    expect((await listProjectManifests(registry, "p2", {})).map((m) => m.id)).toEqual(["b"]);
  });

  it("includes development Templates when asked", async () => {
    const manifests = await listProjectManifests(registry, "p1", { includeDevelopment: true });
    expect(manifests.map((m) => m.id)).toEqual(["a", "dev"]);
  });
});

describe("getProjectManifest", () => {
  it("returns a single manifest, or null when unknown to the Project", async () => {
    expect((await getProjectManifest(registry, "p1", "a", {}))?.name).toBe("Fixture a");
    expect(await getProjectManifest(registry, "p1", "b", {})).toBeNull();
  });

  it("hides a development Template unless included", async () => {
    expect(await getProjectManifest(registry, "p1", "dev", {})).toBeNull();
    expect((await getProjectManifest(registry, "p1", "dev", { includeDevelopment: true }))?.id).toBe("dev");
  });
});

describe("project_templates queries", () => {
  const OWNER = { name: "Owner", email: "o@example.com", tokenIdentifier: "test|owner" };
  const OTHER = { name: "Other", email: "x@example.com", tokenIdentifier: "test|other" };

  async function seed() {
    const t = convexTest(schema, modules);
    const now = new Date().toISOString();
    await t.run(async (ctx) => {
      await insertInstance(ctx, {
        jobId: "job-1",
        status: "running",
        runtimeStatus: "linked",
        runtimeReady: true,
        createdAt: now,
        openclawId: "inst-1",
        updatedAt: now,
        userId: OWNER.tokenIdentifier,
      });
    });
    return t;
  }

  const installSeo = (t: Awaited<ReturnType<typeof seed>>) =>
    t.withIdentity(OWNER).mutation(api.project_templates.install, { projectId: "inst-1", files: readHostedClawPackageFixture("seo") });

  it("serves the Project's installed Templates to its owner, and only those", async () => {
    const t = await seed();
    expect(await t.withIdentity(OWNER).query(api.project_templates.listForProject, { projectId: "inst-1" })).toEqual([]);
    await installSeo(t);
    const list = await t.withIdentity(OWNER).query(api.project_templates.listForProject, { projectId: "inst-1" });
    expect(list.map((m) => m.id)).toEqual(["@acme/seo"]);
    const one = await t.withIdentity(OWNER).query(api.project_templates.getForProject, {
      projectId: "inst-1",
      templateId: "@acme/seo",
    });
    expect(one?.id).toBe("@acme/seo");
    // No compiled-in Template answers for a Project that did not install it.
    expect(
      await t.withIdentity(OWNER).query(api.project_templates.getForProject, { projectId: "inst-1", templateId: "@opengroow/seo" }),
    ).toBeNull();
  });

  it("also resolves a Project addressed by its jobId (as dashboard URLs may)", async () => {
    const t = await seed();
    await installSeo(t);
    const list = await t.withIdentity(OWNER).query(api.project_templates.listForProject, { projectId: "job-1" });
    expect(list.map((m) => m.id)).toContain("@acme/seo");
  });

  it("serves nothing to someone else", async () => {
    const t = await seed();
    await installSeo(t);
    expect(await t.withIdentity(OTHER).query(api.project_templates.listForProject, { projectId: "inst-1" })).toEqual([]);
    expect(
      await t.withIdentity(OTHER).query(api.project_templates.getForProject, { projectId: "inst-1", templateId: "@acme/seo" }),
    ).toBeNull();
  });
});

describe("project_templates.catalogue (#655)", () => {
  const OWNER = { name: "Owner", email: "o@example.com", tokenIdentifier: "test|owner" };
  const OTHER = { name: "Other", email: "x@example.com", tokenIdentifier: "test|other" };

  async function seed() {
    const t = convexTest(schema, modules);
    const now = new Date().toISOString();
    await t.run(async (ctx) => {
      await insertInstance(ctx, {
        jobId: "job-1",
        status: "running",
        runtimeStatus: "linked",
        runtimeReady: true,
        createdAt: now,
        openclawId: "inst-1",
        updatedAt: now,
        userId: OWNER.tokenIdentifier,
      });
    });
    return t;
  }

  it("lists each installed Template with its origin, version and installation plan", async () => {
    const t = await seed();
    expect(await t.withIdentity(OWNER).query(api.project_templates.catalogue, { projectId: "inst-1" })).toEqual([]);
    await t.withIdentity(OWNER).mutation(api.project_templates.install, { projectId: "inst-1", files: readHostedClawPackageFixture("seo") });
    const catalogue = await t.withIdentity(OWNER).query(api.project_templates.catalogue, { projectId: "inst-1" });
    const seo = catalogue.find((entry) => entry.templateId === "@acme/seo");
    expect(seo).toMatchObject({ origin: "local_folder", version: "0.0.1", added: false });
    expect(seo?.manifest.id).toBe("@acme/seo");
    expect(seo?.plan.secrets.map((s) => s.key)).toEqual(["apiKey"]);
    expect(seo?.plan.mcpHosts.length).toBeGreaterThan(0);
    expect(seo?.plan.prerequisites).toEqual([]);
  });

  it("shows the machine prerequisites of an installed package, with their instructions link", async () => {
    const t = await seed();
    const folder = join(import.meta.dirname, "..", "..", "..", "fixtures", "packages", "engagement");
    const base = withFile(readPackageFolder(folder), "package.json", JSON.stringify({ name: "@acme/engagement", version: "0.0.1", openclaw: { claw: "CLAW.md" } }));
    const profile = base.find((f) => f.path === "profiles/opengroow.yml")!.content;
    const files = withFile(
      base,
      "profiles/opengroow.yml",
      `${profile}machinePrerequisites:\n  - name: Example CLI (example-cli)\n    minVersion: 0.0.1\n    instructionsUrl: https://example.com/example-cli\n`,
    );
    await t.withIdentity(OWNER).mutation(api.project_templates.install, { projectId: "inst-1", files });
    const catalogue = await t.withIdentity(OWNER).query(api.project_templates.catalogue, { projectId: "inst-1" });
    const plan = catalogue.find((entry) => entry.templateId === "@acme/engagement")?.plan;
    expect(plan?.prerequisites[0]?.instructionsUrl).toMatch(/^https:\/\//);
    expect(plan?.prerequisites[0]?.name).toContain("Example CLI");
  });

  it("shows a Template installed from a local folder with that origin and its package version", async () => {
    const t = await seed();
    const files = readHostedClawPackageFixture("seo");
    await t.withIdentity(OWNER).mutation(api.project_templates.install, { projectId: "inst-1", files });
    const catalogue = await t.withIdentity(OWNER).query(api.project_templates.catalogue, { projectId: "inst-1" });
    expect(catalogue.filter((entry) => entry.templateId === "@acme/seo")).toHaveLength(1);
    expect(catalogue.find((entry) => entry.templateId === "@acme/seo")).toMatchObject({
      origin: "local_folder",
      version: "0.0.1",
    });
  });

  it("marks a Template the Project already has an Agent of", async () => {
    const t = await seed();
    await t.withIdentity(OWNER).mutation(api.project_templates.install, { projectId: "inst-1", files: readHostedClawPackageFixture("seo") });
    await t.run(async (ctx) => {
      await ctx.db.insert("projectAgents", {
        instanceId: "inst-1",
        templateId: "@acme/seo",
        status: "inactive",
        mcpServerKeys: [],
        createdAt: 1,
        updatedAt: 1,
      });
    });
    const catalogue = await t.withIdentity(OWNER).query(api.project_templates.catalogue, { projectId: "inst-1" });
    expect(catalogue.find((entry) => entry.templateId === "@acme/seo")?.added).toBe(true);
  });

  it("serves nothing to someone else", async () => {
    const t = await seed();
    await t.withIdentity(OWNER).mutation(api.project_templates.install, { projectId: "inst-1", files: readHostedClawPackageFixture("seo") });
    expect(await t.withIdentity(OTHER).query(api.project_templates.catalogue, { projectId: "inst-1" })).toEqual([]);
  });
});

// The public install is self-host only (#707): these tests install packages the way a self-hosted owner does.
beforeEach(() => {
  vi.stubEnv("IS_SELF_HOST", "1");
});
afterEach(() => {
  vi.unstubAllEnvs();
});
