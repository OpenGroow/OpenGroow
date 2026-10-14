import { insertInstance } from "./instance_fixture";
import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import { api } from "../_generated/api";
import schema from "../schema";
import { tarGz } from "../../../packages/agent-templates/src/__fixtures__/tar-gz";
import { readHostedClawPackageFixture, type PackageFile } from "../../../packages/agent-templates/src/__fixtures__/claw-package";

const modules = {
  "../_generated/api.ts": () => import("../_generated/api.js"),
  "../project_templates.ts": () => import("../project_templates.js"),
  "../project_templates_node.ts": () => import("../project_templates_node.js"),
  "../template_install_local.ts": () => import("../template_install_local.js"),
  "../project_agents.ts": () => import("../project_agents.js"),
  "../instances.ts": () => import("../instances.js"),
  "../project_agents_node.ts": () => import("../project_agents_node.js"),
};

const PROJECT = "openclaw-hub-1";
const OWNER = { name: "Owner", email: "o@e.com", tokenIdentifier: "test|hub", subject: "owner-hub" };
const INTRUDER = { name: "X", email: "x@e.com", tokenIdentifier: "test|x", subject: "intruder-hub" };

const withId = (files: PackageFile[], id: string): PackageFile[] =>
  files.map((f) => (f.path === "package.json" ? { ...f, content: f.content.replace(/"name": ".*"/, `"name": "${id}"`) } : f));

const archiveOf = (files: PackageFile[]) =>
  tarGz(files.map((f) => ({ name: `pkg-v1/${f.path}`, content: f.content })));
const sha = (b: Buffer) => `sha256:${createHash("sha256").update(b).digest("hex")}`;

const COMMUNITY_ARCHIVE = archiveOf(withId(readHostedClawPackageFixture("seo"), "@alice/seo"));
const OFFICIAL_ARCHIVE = archiveOf(withId(readHostedClawPackageFixture("seo"), "@opengroow/seo"));

type Hub = { packages: Record<string, unknown>[]; archives: Record<string, Buffer> };

/** The network: a hub index and the release archives it points at. Anything else is a 404. */
function stubNetwork(hub: Hub) {
  const fetchMock = vi.fn(async (url: string) => {
    if (url === "https://raw.githubusercontent.com/acme/hub/main/index.json") {
      return new Response(JSON.stringify({ schemaVersion: 1, packages: hub.packages }));
    }
    const archive = hub.archives[url];
    return archive ? new Response(new Uint8Array(archive)) : new Response(null, { status: 404 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const entry = (id: string, archive: Buffer, extra: Record<string, unknown> = {}) => ({
  id,
  name: id,
  description: `The ${id} agent`,
  repository: `acme/${id.split("/")[1]}`,
  tag: "v1.0.0",
  digest: sha(archive),
  category: "marketing",
  verification: "community",
  ...extra,
});
const archiveUrl = (name: string) => `https://github.com/acme/${name}/archive/refs/tags/v1.0.0.tar.gz`;

async function seedProject(t: ReturnType<typeof convexTest>) {
  const now = new Date().toISOString();
  await t.run(async (ctx) => {
    await insertInstance(ctx, {
      jobId: "job-hub",
      status: "running",
      runtimeStatus: "linked",
      runtimeReady: true,
      createdAt: now,
      openclawId: PROJECT,
      updatedAt: now,
      userId: OWNER.subject,
    });
  });
}

beforeEach(() => {
  vi.stubEnv("OPENGROOW_HUB_REPOSITORY", "acme/hub");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("hubCatalogue", () => {
  it("lists the hub entries with their trust badge", async () => {
    stubNetwork({
      packages: [
        entry("@alice/seo", COMMUNITY_ARCHIVE),
        entry("@opengroow/seo", OFFICIAL_ARCHIVE, { verification: "official" }),
      ],
      archives: {},
    });
    const t = convexTest(schema, modules);
    const result = await t.withIdentity(OWNER).action(api.project_templates_node.hubCatalogue, {});
    expect(result).toEqual({
      entries: [
        { templateId: "@alice/seo", name: "@alice/seo", description: "The @alice/seo agent", category: "marketing", tag: "v1.0.0", verification: "community" },
        { templateId: "@opengroow/seo", name: "@opengroow/seo", description: "The @opengroow/seo agent", category: "marketing", tag: "v1.0.0", verification: "official" },
      ],
    });
  });

  it("reports an unreachable or invalid hub instead of failing the catalogue", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ schemaVersion: 1, packages: [], extra: 1 }))));
    const t = convexTest(schema, modules);
    const result = await t.withIdentity(OWNER).action(api.project_templates_node.hubCatalogue, {});
    expect(result.entries).toEqual([]);
    expect(result.error).toMatch(/extra/);
  });

  it("requires a signed-in user", async () => {
    stubNetwork({ packages: [], archives: {} });
    const t = convexTest(schema, modules);
    await expect(t.action(api.project_templates_node.hubCatalogue, {})).rejects.toThrow(/Authentication required/);
  });
});

describe("installHubTemplate", () => {
  const network = () =>
    stubNetwork({ packages: [entry("@alice/seo", COMMUNITY_ARCHIVE)], archives: { [archiveUrl("seo")]: COMMUNITY_ARCHIVE } });

  it("installs the entry with its recorded digest and records the hub origin", async () => {
    network();
    const t = convexTest(schema, modules);
    await seedProject(t);

    const result = await t
      .withIdentity(OWNER)
      .action(api.project_templates_node.installHubTemplate, { instanceId: PROJECT, templateId: "@alice/seo" });

    expect(result).toMatchObject({ status: "installed", templateId: "@alice/seo" });
    const origins = await t.withIdentity(OWNER).query(api.project_templates.origins, { projectId: PROJECT });
    expect(origins).toEqual([
      expect.objectContaining({
        templateId: "@alice/seo",
        origin: "hub",
        gitOrigin: { repository: "https://github.com/acme/seo", tag: "v1.0.0", archiveDigest: sha(COMMUNITY_ARCHIVE) },
      }),
    ]);
  });

  it("refuses an archive that does not match the digest recorded in the index, installing nothing", async () => {
    stubNetwork({
      packages: [entry("@alice/seo", COMMUNITY_ARCHIVE)],
      archives: { [archiveUrl("seo")]: OFFICIAL_ARCHIVE },
    });
    const t = convexTest(schema, modules);
    await seedProject(t);

    const result = await t
      .withIdentity(OWNER)
      .action(api.project_templates_node.installHubTemplate, { instanceId: PROJECT, templateId: "@alice/seo" });

    expect(result).toEqual({ status: "error", errorMessage: expect.stringMatching(/Digest mismatch/) });
    expect(await t.withIdentity(OWNER).query(api.project_templates.origins, { projectId: PROJECT })).toEqual([]);
  });

  it("refuses a package whose id differs from the index entry's", async () => {
    stubNetwork({
      packages: [entry("@alice/seo", OFFICIAL_ARCHIVE)],
      archives: { [archiveUrl("seo")]: OFFICIAL_ARCHIVE },
    });
    const t = convexTest(schema, modules);
    await seedProject(t);

    const result = await t
      .withIdentity(OWNER)
      .action(api.project_templates_node.installHubTemplate, { instanceId: PROJECT, templateId: "@alice/seo" });

    expect(result).toEqual({ status: "error", errorMessage: expect.stringMatching(/@alice\/seo.*@opengroow\/seo/) });
  });

  it("refuses an entry the hub does not list", async () => {
    network();
    const t = convexTest(schema, modules);
    await seedProject(t);
    const result = await t
      .withIdentity(OWNER)
      .action(api.project_templates_node.installHubTemplate, { instanceId: PROJECT, templateId: "@alice/other" });
    expect(result).toEqual({ status: "error", errorMessage: expect.stringMatching(/not listed/) });
  });

  it("refuses a user who does not own the Project", async () => {
    network();
    const t = convexTest(schema, modules);
    await seedProject(t);
    const result = await t
      .withIdentity(INTRUDER)
      .action(api.project_templates_node.installHubTemplate, { instanceId: PROJECT, templateId: "@alice/seo" });
    expect(result).toEqual({ status: "error", errorMessage: "Forbidden" });
  });
});

describe("previewHubTemplate", () => {
  it("shows the manifest and installation plan of a verified download without installing it", async () => {
    stubNetwork({ packages: [entry("@alice/seo", COMMUNITY_ARCHIVE)], archives: { [archiveUrl("seo")]: COMMUNITY_ARCHIVE } });
    const t = convexTest(schema, modules);
    await seedProject(t);

    const result = await t
      .withIdentity(OWNER)
      .action(api.project_templates_node.previewHubTemplate, { instanceId: PROJECT, templateId: "@alice/seo" });

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.manifest.id).toBe("@alice/seo");
    expect(result.plan.mcpHosts.length).toBeGreaterThan(0);
    expect(await t.withIdentity(OWNER).query(api.project_templates.origins, { projectId: PROJECT })).toEqual([]);
  });
});
