import { insertInstance } from "./instance_fixture";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import { internal } from "../_generated/api";
import schema from "../schema";
import { readClawPackageFixture, withFile } from "../../../packages/agent-templates/src/__fixtures__/claw-package";

/**
 * Hosted deployment safety (#670): a package's MCP URLs are checked at install
 * time on the hosted deployment (IS_SELF_HOST unset) and left alone on a
 * self-hosted one.
 */

const modules = {
  "../_generated/api.ts": () => import("../_generated/api.js"),
  "../template_install_local.ts": () => import("../template_install_local.js"),
};

const PROJECT = "openclaw-project-hosted";
const install = internal.template_install_local.install;

function seoPackageWithMcp(urls: { url: string; activationUrl?: string; publicBaseUrl?: string }) {
  const base = readClawPackageFixture("seo");
  const profile = base.find((f) => f.path === "profiles/opengroow.yml")!.content;
  const lines = [`    url: ${urls.url}`];
  if (urls.activationUrl) lines.push(`    activationUrl: ${urls.activationUrl}`);
  if (urls.publicBaseUrl) lines.push(`    publicBaseUrl: ${urls.publicBaseUrl}`);
  const patched = profile.replace(/    url: .*\n    activationUrl: .*\n    publicBaseUrl: .*\n/, `${lines.join("\n")}\n`);
  expect(patched).not.toBe(profile);
  return withFile(base, "profiles/opengroow.yml", patched);
}

async function seed() {
  const t = convexTest(schema, modules);
  const now = new Date().toISOString();
  await t.run(async (ctx) => {
    await insertInstance(ctx, {
      jobId: "job-hosted",
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

const installed = (t: Awaited<ReturnType<typeof seed>>) =>
  t.run(async (ctx) => ctx.db.query("installedTemplates").collect());

describe("MCP URLs of an installed package", () => {
  const original = process.env.IS_SELF_HOST;
  beforeEach(() => {
    delete process.env.IS_SELF_HOST;
  });
  afterEach(() => {
    if (original === undefined) delete process.env.IS_SELF_HOST;
    else process.env.IS_SELF_HOST = original;
  });

  it("installs a package whose MCP URL is public on the hosted deployment", async () => {
    const t = await seed();
    await t.mutation(install, { projectId: PROJECT, files: seoPackageWithMcp({ url: "https://seo.example.com/mcp" }) });
    expect(await installed(t)).toHaveLength(1);
  });

  it.each([
    "http://localhost:4000/mcp",
    "http://127.0.0.1:4000/mcp",
    "http://10.1.2.3/mcp",
    "http://169.254.169.254/latest/meta-data/",
    "http://[::1]/mcp",
    "http://2130706433/mcp",
    "http://host.docker.internal:4000/mcp",
    "http://ok@evil.example.com/mcp",
  ])("refuses a package whose MCP URL is %s on the hosted deployment, storing nothing", async (url) => {
    const t = await seed();
    await expect(t.mutation(install, { projectId: PROJECT, files: seoPackageWithMcp({ url }) })).rejects.toThrow(
      /article-mcp.*hosted/s,
    );
    expect(await installed(t)).toHaveLength(0);
  });

  it("also checks the Convex-only activation and public URLs", async () => {
    const t = await seed();
    const base = { url: "https://seo.example.com/mcp" };
    await expect(
      t.mutation(install, { projectId: PROJECT, files: seoPackageWithMcp({ ...base, activationUrl: "http://localhost:4000/mcp" }) }),
    ).rejects.toThrow(/activationUrl/);
    await expect(
      t.mutation(install, { projectId: PROJECT, files: seoPackageWithMcp({ ...base, publicBaseUrl: "http://192.168.0.2" }) }),
    ).rejects.toThrow(/publicBaseUrl/);
    expect(await installed(t)).toHaveLength(0);
  });

  it("leaves a self-hosted deployment unaffected: local MCP URLs install", async () => {
    process.env.IS_SELF_HOST = "1";
    const t = await seed();
    await t.mutation(install, { projectId: PROJECT, files: readClawPackageFixture("seo") });
    expect(await installed(t)).toHaveLength(1);
    expect((await installed(t))[0]!.manifest.mcpServers[0]!.url).toBe("http://host.docker.internal:4000/mcp");
  });
});
