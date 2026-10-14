import { insertInstance } from "./instance_fixture";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import { api } from "../_generated/api";
import schema from "../schema";
import { readClawPackageFixture } from "../../../packages/agent-templates/src/__fixtures__/claw-package";

/** Add Agent from a local folder (#707): self-host only, gated on the server. */

const modules = {
  "../_generated/api.ts": () => import("../_generated/api.js"),
  "../project_templates.ts": () => import("../project_templates.js"),
  "../project_templates_node.ts": () => import("../project_templates_node.js"),
  "../template_install_local.ts": () => import("../template_install_local.js"),
  "../project_agents.ts": () => import("../project_agents.js"),
  "../instances.ts": () => import("../instances.js"),
  "../project_agents_node.ts": () => import("../project_agents_node.js"),
};

const PROJECT = "openclaw-local-1";
const OWNER = { name: "Owner", email: "o@e.com", tokenIdentifier: "test|local", subject: "owner-local" };
const INTRUDER = { name: "X", email: "x@e.com", tokenIdentifier: "test|x", subject: "intruder-local" };

const files = readClawPackageFixture("seo");

async function seedProject() {
  const t = convexTest(schema, modules);
  const now = new Date().toISOString();
  await t.run(async (ctx) => {
    await insertInstance(ctx, {
      jobId: "job-local",
      status: "running",
      runtimeStatus: "linked",
      runtimeReady: true,
      createdAt: now,
      openclawId: PROJECT,
      updatedAt: now,
      userId: OWNER.subject,
    });
  });
  return t;
}

const origins = (t: Awaited<ReturnType<typeof seedProject>>) =>
  t.withIdentity(OWNER).query(api.project_templates.origins, { projectId: PROJECT });

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("on a self-hosted deployment", () => {
  beforeEach(() => {
    vi.stubEnv("IS_SELF_HOST", "1");
  });

  it("previews the manifest and installation plan of a folder without installing it", async () => {
    const t = await seedProject();
    const result = await t.withIdentity(OWNER).action(api.project_templates_node.previewLocalFolder, { instanceId: PROJECT, files });

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.manifest.id).toBe("@acme/seo");
    expect(result.plan.mcpHosts.length).toBeGreaterThan(0);
    expect(await origins(t)).toEqual([]);
  });

  it("reports an invalid package with the adapter's message, storing nothing", async () => {
    const t = await seedProject();
    const broken = files.filter((f) => f.path !== "CLAW.md");
    const result = await t.withIdentity(OWNER).action(api.project_templates_node.previewLocalFolder, { instanceId: PROJECT, files: broken });
    expect(result).toEqual({ status: "error", errorMessage: expect.stringMatching(/CLAW\.md/) });
    expect(await origins(t)).toEqual([]);
  });

  it("installs the folder with the local_folder origin", async () => {
    const t = await seedProject();
    const result = await t.withIdentity(OWNER).action(api.project_templates_node.installLocalFolder, { instanceId: PROJECT, files });

    expect(result).toMatchObject({ status: "installed", templateId: "@acme/seo" });
    expect(await origins(t)).toEqual([expect.objectContaining({ templateId: "@acme/seo", origin: "local_folder" })]);
  });

  it("refuses an invalid package with its message, installing nothing", async () => {
    const t = await seedProject();
    const broken = files.map((f) => (f.path === "package.json" ? { ...f, content: "{" } : f));
    const result = await t.withIdentity(OWNER).action(api.project_templates_node.installLocalFolder, { instanceId: PROJECT, files: broken });
    expect(result.status).toBe("error");
    expect(await origins(t)).toEqual([]);
  });

  it("refuses a user who does not own the Project", async () => {
    const t = await seedProject();
    const preview = await t.withIdentity(INTRUDER).action(api.project_templates_node.previewLocalFolder, { instanceId: PROJECT, files });
    const install = await t.withIdentity(INTRUDER).action(api.project_templates_node.installLocalFolder, { instanceId: PROJECT, files });
    expect(preview).toEqual({ status: "error", errorMessage: "Forbidden" });
    expect(install).toEqual({ status: "error", errorMessage: "Forbidden" });
    expect(await origins(t)).toEqual([]);
  });

  it("keeps the public install mutation available", async () => {
    const t = await seedProject();
    await t.withIdentity(OWNER).mutation(api.project_templates.install, { projectId: PROJECT, files });
    expect(await origins(t)).toHaveLength(1);
  });
});

describe("on the hosted deployment", () => {
  beforeEach(() => {
    vi.stubEnv("IS_SELF_HOST", "");
  });

  it("refuses to preview a folder", async () => {
    const t = await seedProject();
    const result = await t.withIdentity(OWNER).action(api.project_templates_node.previewLocalFolder, { instanceId: PROJECT, files });
    expect(result).toEqual({ status: "error", errorMessage: expect.stringMatching(/self-hosted/) });
  });

  it("refuses to install a folder, storing nothing", async () => {
    const t = await seedProject();
    const result = await t.withIdentity(OWNER).action(api.project_templates_node.installLocalFolder, { instanceId: PROJECT, files });
    expect(result).toEqual({ status: "error", errorMessage: expect.stringMatching(/self-hosted/) });
    expect(await origins(t)).toEqual([]);
  });

  it("refuses the public install mutation, storing nothing", async () => {
    const t = await seedProject();
    await expect(t.withIdentity(OWNER).mutation(api.project_templates.install, { projectId: PROJECT, files })).rejects.toThrow(
      /self-hosted/,
    );
    expect(await origins(t)).toEqual([]);
  });
});
