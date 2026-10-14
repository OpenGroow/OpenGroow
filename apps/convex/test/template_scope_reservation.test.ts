import { insertInstance } from "./instance_fixture";
import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import { internal } from "../_generated/api";
import schema from "../schema";
import { readHostedClawPackageFixture, withFile, type PackageFile } from "../../../packages/agent-templates/src/__fixtures__/claw-package";

/**
 * The @opengroow scope is reserved to the official hub (#666): a package outside
 * it cannot declare a system Template, and a @opengroow package is only
 * accepted from the hub origin.
 */

const modules = {
  "../_generated/api.ts": () => import("../_generated/api.js"),
  "../template_install_local.ts": () => import("../template_install_local.js"),
};

const PROJECT = "openclaw-project-scope";
const GIT_ORIGIN = { repository: "https://github.com/acme/seo", tag: "v1.0.0", archiveDigest: `sha256:${"a".repeat(64)}` };

/** The SEO fixture re-identified: `id` is the package name, `category` is in the OpenGroow profile. */
function seoAs(id: string, category?: string): PackageFile[] {
  let files = readHostedClawPackageFixture("seo");
  const pkg = files.find((f) => f.path === "package.json")!.content.replace(/"name": ".*"/, `"name": "${id}"`);
  files = withFile(files, "package.json", pkg);
  if (category) {
    const profile = files.find((f) => f.path === "profiles/opengroow.yml")!.content.replace(/^category: .*$/m, `category: ${category}`);
    files = withFile(files, "profiles/opengroow.yml", profile);
  }
  return files;
}

async function seed() {
  const t = convexTest(schema, modules);
  const now = new Date().toISOString();
  await t.run(async (ctx) => {
    await insertInstance(ctx, {
      jobId: "job-scope",
      status: "running",
      runtimeStatus: "linked",
      runtimeReady: true,
      createdAt: now,
      openclawId: PROJECT,
      updatedAt: now,
      userId: "owner",
    });
  });
  return t;
}

const installed = (t: Awaited<ReturnType<typeof seed>>) => t.run(async (ctx) => ctx.db.query("installedTemplates").collect());

describe("@opengroow scope reservation at install", () => {
  it("installs an official package from the hub", async () => {
    const t = await seed();
    await t.mutation(internal.template_install_local.installHub, { projectId: PROJECT, files: seoAs("@opengroow/seo"), gitOrigin: GIT_ORIGIN });
    expect(await installed(t)).toEqual([expect.objectContaining({ templateId: "@opengroow/seo", origin: "hub" })]);
  });

  it("installs a community package with ordinary content from a folder", async () => {
    const t = await seed();
    await t.mutation(internal.template_install_local.install, { projectId: PROJECT, files: seoAs("@alice/seo") });
    expect(await installed(t)).toHaveLength(1);
  });

  it.each([
    ["a local folder", internal.template_install_local.install, {}],
    ["a linked folder", internal.template_install_local.link, {}],
    ["Git", internal.template_install_local.installGit, { gitOrigin: GIT_ORIGIN }],
  ] as const)("refuses a @opengroow package installed from %s, storing nothing", async (_label, mutation, extra) => {
    const t = await seed();
    await expect(t.mutation(mutation, { projectId: PROJECT, files: seoAs("@opengroow/seo"), ...extra })).rejects.toThrow(
      /@opengroow\/seo.*reserved.*official hub/,
    );
    expect(await installed(t)).toHaveLength(0);
  });

  it("refuses a non-@opengroow package declaring category system, even from the hub, storing nothing", async () => {
    const t = await seed();
    await expect(
      t.mutation(internal.template_install_local.installHub, {
        projectId: PROJECT,
        files: seoAs("@alice/source", "system"),
        gitOrigin: GIT_ORIGIN,
      }),
    ).rejects.toThrow(/@alice\/source.*only the @opengroow scope may declare category "system"/);
    expect(await installed(t)).toHaveLength(0);
  });

  it("refuses an offered update of a @opengroow package that is not from the hub", async () => {
    const t = await seed();
    await t.mutation(internal.template_install_local.installHub, { projectId: PROJECT, files: seoAs("@opengroow/seo"), gitOrigin: GIT_ORIGIN });
    const v2 = withFile(
      seoAs("@opengroow/seo"),
      "package.json",
      JSON.stringify({ ...JSON.parse(seoAs("@opengroow/seo").find((f) => f.path === "package.json")!.content), version: "9.9.9" }),
    );
    await expect(t.mutation(internal.template_install_local.offerUpdate, { projectId: PROJECT, files: v2 })).rejects.toThrow(/reserved/);
  });

  it("accepts an offered update of a @opengroow package from the official hub, tagged with the hub origin", async () => {
    const t = await seed();
    await t.mutation(internal.template_install_local.installHub, { projectId: PROJECT, files: seoAs("@opengroow/seo"), gitOrigin: GIT_ORIGIN });
    const v2 = withFile(
      seoAs("@opengroow/seo"),
      "package.json",
      JSON.stringify({ ...JSON.parse(seoAs("@opengroow/seo").find((f) => f.path === "package.json")!.content), version: "9.9.9" }),
    );
    await t.mutation(internal.template_install_local.offerHubUpdate, { projectId: PROJECT, files: v2, gitOrigin: GIT_ORIGIN });
    expect(await installed(t)).toEqual(
      expect.arrayContaining([expect.objectContaining({ version: "9.9.9", staged: true, origin: "hub" })]),
    );
  });

  it("is not enforced on a self-hosted deployment: a folder install of a @opengroow package or a system package is accepted", async () => {
    const original = process.env.IS_SELF_HOST;
    process.env.IS_SELF_HOST = "1";
    try {
      const t = await seed();
      await t.mutation(internal.template_install_local.install, { projectId: PROJECT, files: seoAs("@opengroow/seo") });
      await t.mutation(internal.template_install_local.install, { projectId: PROJECT, files: seoAs("@alice/source", "system") });
      expect((await installed(t)).map((doc) => doc.templateId).sort()).toEqual(["@alice/source", "@opengroow/seo"]);
    } finally {
      if (original === undefined) delete process.env.IS_SELF_HOST;
      else process.env.IS_SELF_HOST = original;
    }
  });
});
