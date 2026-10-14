import { insertInstance } from "./instance_fixture";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import { api } from "../_generated/api";
import schema from "../schema";
import { getTemplateRegistry } from "../template_registry";
import { readHostedClawPackageFixture, withFile } from "../../../packages/agent-templates/src/__fixtures__/claw-package";

const modules = {
  "../_generated/api.ts": () => import("../_generated/api.js"),
  "../project_templates.ts": () => import("../project_templates.js"),
  "../project_agents.ts": () => import("../project_agents.js"),
};

const PROJECT_A = "openclaw-registry-a";
const PROJECT_B = "openclaw-registry-b";
const OWNER = { name: "Owner", email: "o@e.com", tokenIdentifier: "test|reg", subject: "owner-reg" };
const INTRUDER = { name: "X", email: "x@e.com", tokenIdentifier: "test|x", subject: "intruder-reg" };

async function seedProjects(t: ReturnType<typeof convexTest>) {
  const now = new Date().toISOString();
  await t.run(async (ctx) => {
    for (const openclawId of [PROJECT_A, PROJECT_B]) {
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
    }
  });
}

const seoPackage = () => readHostedClawPackageFixture("seo");
// Templates carry functions, which `t.run` cannot return: summarize the data.
const resolveIn = (t: ReturnType<typeof convexTest>, projectId: string, templateId: string, version?: string) =>
  t.run(async (ctx) => {
    const template = await getTemplateRegistry(ctx).resolve(projectId, templateId, version);
    return template
      ? {
          id: template.manifest.id,
          agentsMd: template.agentsMd,
          missionAgentsMd: template.missionAgentsMd,
          missionTypes: template.manifest.missionTypes?.map((m) => m.type) ?? [],
        }
      : null;
  });

describe("Project Template registry", () => {
  it("installs a Claw package into a Project and resolves it from the registry", async () => {
    const t = convexTest(schema, modules);
    await seedProjects(t);
    const files = withFile(seoPackage(), "workspace/AGENTS.md", "# Installed marker\n");

    const installed = await t
      .withIdentity(OWNER)
      .mutation(api.project_templates.install, { projectId: PROJECT_A, files });

    expect(installed).toMatchObject({ templateId: "@acme/seo", version: "0.0.1" });
    expect(installed.digest).toMatch(/^sha256:[0-9a-f]{64}$/);
    const template = await resolveIn(t, PROJECT_A, "@acme/seo");
    expect(template?.agentsMd).toBe("# Installed marker\n");
    expect(template?.missionAgentsMd?.create_article).toContain("Create Article");
    expect(template?.missionTypes).toContain("create_article");
  });

  it("stores one document per package file", async () => {
    const t = convexTest(schema, modules);
    await seedProjects(t);
    const files = seoPackage();
    await t.withIdentity(OWNER).mutation(api.project_templates.install, { projectId: PROJECT_A, files });

    const stored = await t.run(async (ctx) => ctx.db.query("templateFiles").collect());
    expect(stored.map((f) => f.path).sort()).toEqual(files.map((f) => f.path).sort());
  });

  it("an installation in one Project does not affect another Project", async () => {
    const t = convexTest(schema, modules);
    await seedProjects(t);
    const files = withFile(seoPackage(), "workspace/AGENTS.md", "# Only in A\n");
    await t.withIdentity(OWNER).mutation(api.project_templates.install, { projectId: PROJECT_A, files });

    expect((await resolveIn(t, PROJECT_A, "@acme/seo"))?.agentsMd).toBe("# Only in A\n");
    // Project B installed nothing: there is no compiled-in Template to fall back to (#674).
    expect(await resolveIn(t, PROJECT_B, "@acme/seo")).toBeNull();
  });

  // #674: no Project resolves any Template through the retired "builtin" fallback.
  describe("no built-in fallback", () => {
    const FORMER_BUILTINS = [
      "hello",
      "moneyprinterturbo",
      "openmontage-agent",
      "seo",
      "social-engagement",
      "source",
      "video-demo",
      "visual-social",
    ].flatMap((name) => [name, `@opengroow/${name}`, `@opengroow/${name}`]);

    it("a Project with nothing installed resolves none of the former built-in Templates, at any version", async () => {
      const t = convexTest(schema, modules);
      await seedProjects(t);
      for (const id of FORMER_BUILTINS) {
        expect(await resolveIn(t, PROJECT_A, id), id).toBeNull();
        expect(await resolveIn(t, PROJECT_A, id, "builtin"), `${id}@builtin`).toBeNull();
      }
      expect(await t.run(async (ctx) => getTemplateRegistry(ctx).list(PROJECT_A, { includeDevelopment: true }))).toEqual([]);
    });

    it('never resolves an installed Template through the "builtin" version', async () => {
      const t = convexTest(schema, modules);
      await seedProjects(t);
      await t.withIdentity(OWNER).mutation(api.project_templates.install, { projectId: PROJECT_A, files: seoPackage() });
      expect(await resolveIn(t, PROJECT_A, "@acme/seo", "builtin")).toBeNull();
      expect(await resolveIn(t, PROJECT_A, "@acme/seo", "0.0.1")).not.toBeNull();
    });
  });

  it("resolves a package whose id is not built in, only in the Project that installed it", async () => {
    const t = convexTest(schema, modules);
    await seedProjects(t);
    const files = withFile(
      withFile(
        seoPackage(),
        "CLAW.md",
        "---\nschemaVersion: 1\nagent:\n  id: acme-seo\n  name: Acme SEO\n  description: Acme\n---\n\nPrompt\n",
      ),
      "package.json",
      JSON.stringify({ name: "acme-seo", version: "0.0.1", openclaw: { claw: "CLAW.md" } }),
    );
    await t.withIdentity(OWNER).mutation(api.project_templates.install, { projectId: PROJECT_A, files });

    expect((await resolveIn(t, PROJECT_A, "acme-seo"))?.id).toBe("acme-seo");
    expect(await resolveIn(t, PROJECT_B, "acme-seo")).toBeNull();
    const listed = await t.run(async (ctx) => (await getTemplateRegistry(ctx).list(PROJECT_A)).map((x) => x.manifest.id));
    expect(listed).toContain("acme-seo");
  });

  it("keeps several versions: latest by default, an exact version on request", async () => {
    const t = convexTest(schema, modules);
    await seedProjects(t);
    const v1 = withFile(seoPackage(), "workspace/AGENTS.md", "# v1\n");
    const v2 = withFile(
      withFile(seoPackage(), "workspace/AGENTS.md", "# v2\n"),
      "package.json",
      JSON.stringify({ name: "@acme/seo", version: "0.0.2", openclaw: { claw: "CLAW.md" } }),
    );
    const as = t.withIdentity(OWNER);
    await as.mutation(api.project_templates.install, { projectId: PROJECT_A, files: v1 });
    await as.mutation(api.project_templates.install, { projectId: PROJECT_A, files: v2 });

    expect((await resolveIn(t, PROJECT_A, "@acme/seo"))?.agentsMd).toBe("# v2\n");
    expect((await resolveIn(t, PROJECT_A, "@acme/seo", "0.0.1"))?.agentsMd).toBe("# v1\n");
    expect(await resolveIn(t, PROJECT_A, "@acme/seo", "9.9.9")).toBeNull();
  });

  it("reinstalling a version with an identical package is accepted and changes nothing", async () => {
    const t = convexTest(schema, modules);
    await seedProjects(t);
    const as = t.withIdentity(OWNER);
    const first = await as.mutation(api.project_templates.install, { projectId: PROJECT_A, files: seoPackage() });
    const again = await as.mutation(api.project_templates.install, {
      projectId: PROJECT_A,
      files: [...seoPackage()].reverse(),
    });

    expect(again).toEqual(first);
    const rows = await t.run(async (ctx) => ctx.db.query("installedTemplates").collect());
    expect(rows).toHaveLength(1);
    const count = await t.run(async (ctx) => (await ctx.db.query("templateFiles").collect()).length);
    expect(count).toBe(seoPackage().length);
  });

  it("reinstalling an older identical version does not make it current again", async () => {
    const t = convexTest(schema, modules);
    await seedProjects(t);
    const as = t.withIdentity(OWNER);
    const v2 = withFile(
      withFile(seoPackage(), "workspace/AGENTS.md", "# v2\n"),
      "package.json",
      JSON.stringify({ name: "@acme/seo", version: "0.0.2", openclaw: { claw: "CLAW.md" } }),
    );
    await as.mutation(api.project_templates.install, { projectId: PROJECT_A, files: seoPackage() });
    await as.mutation(api.project_templates.install, { projectId: PROJECT_A, files: v2 });
    await as.mutation(api.project_templates.install, { projectId: PROJECT_A, files: seoPackage() });

    expect((await resolveIn(t, PROJECT_A, "@acme/seo"))?.agentsMd).toBe("# v2\n");
  });

  it("refuses reinstalling a version with different content and asks for a new version", async () => {
    const t = convexTest(schema, modules);
    await seedProjects(t);
    const as = t.withIdentity(OWNER);
    await as.mutation(api.project_templates.install, {
      projectId: PROJECT_A,
      files: withFile(seoPackage(), "workspace/AGENTS.md", "# first\n"),
    });

    await expect(
      as.mutation(api.project_templates.install, {
        projectId: PROJECT_A,
        files: withFile(seoPackage(), "workspace/AGENTS.md", "# second\n"),
      }),
    ).rejects.toThrow(/change the version/i);
    expect((await resolveIn(t, PROJECT_A, "@acme/seo"))?.agentsMd).toBe("# first\n");
  });

  it("computes the digest on the package files", async () => {
    const t = convexTest(schema, modules);
    await seedProjects(t);
    const as = t.withIdentity(OWNER);
    const a = await as.mutation(api.project_templates.install, { projectId: PROJECT_A, files: seoPackage() });
    const sameInOtherOrder = await as.mutation(api.project_templates.install, {
      projectId: PROJECT_B,
      files: [...seoPackage()].reverse(),
    });
    const changed = await as.mutation(api.project_templates.install, {
      projectId: PROJECT_B,
      files: withFile(
        withFile(seoPackage(), "workspace/AGENTS.md", "# changed\n"),
        "package.json",
        JSON.stringify({ name: "@acme/seo", version: "0.0.2", openclaw: { claw: "CLAW.md" } }),
      ),
    });

    expect(sameInOtherOrder.digest).toBe(a.digest);
    expect(changed.digest).not.toBe(a.digest);
  });

  it("refuses an invalid package with the adapter's message and stores nothing", async () => {
    const t = convexTest(schema, modules);
    await seedProjects(t);
    const profile = seoPackage().find((f) => f.path === "profiles/opengroow.yml")!.content;
    const files = withFile(seoPackage(), "profiles/opengroow.yml", `${profile}\nbogusKey: 1\n`);

    await expect(
      t.withIdentity(OWNER).mutation(api.project_templates.install, { projectId: PROJECT_A, files }),
    ).rejects.toThrow(/bogusKey/);
    expect(await t.run(async (ctx) => ctx.db.query("installedTemplates").collect())).toEqual([]);
    expect(await t.run(async (ctx) => ctx.db.query("templateFiles").collect())).toEqual([]);
  });

  it("refuses a package without a version", async () => {
    const t = convexTest(schema, modules);
    await seedProjects(t);
    const files = withFile(seoPackage(), "package.json", JSON.stringify({ name: "@acme/seo", openclaw: { claw: "CLAW.md" } }));
    await expect(
      t.withIdentity(OWNER).mutation(api.project_templates.install, { projectId: PROJECT_A, files }),
    ).rejects.toThrow(/version/);
  });

  it("refuses a caller who does not own the Project", async () => {
    const t = convexTest(schema, modules);
    await seedProjects(t);
    await expect(
      t.withIdentity(INTRUDER).mutation(api.project_templates.install, { projectId: PROJECT_A, files: seoPackage() }),
    ).rejects.toThrow(/not accessible/);
  });
});

// The public install is self-host only (#707): these tests install packages the way a self-hosted owner does.
beforeEach(() => {
  vi.stubEnv("IS_SELF_HOST", "1");
});
afterEach(() => {
  vi.unstubAllEnvs();
});
