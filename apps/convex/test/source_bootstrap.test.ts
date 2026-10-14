import { insertInstance } from "./instance_fixture";
import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import { internal } from "../_generated/api";
import schema from "../schema";
import { tarGz } from "../../../packages/agent-templates/src/__fixtures__/tar-gz";
import { readHostedClawPackageFixture, type PackageFile } from "../../../packages/agent-templates/src/__fixtures__/claw-package";

const withId = (files: PackageFile[], id: string): PackageFile[] =>
  files.map((f) => (f.path === "package.json" ? { ...f, content: f.content.replace(/"name": ".*"/, `"name": "${id}"`) } : f));
const archiveOf = (files: PackageFile[]) => tarGz(files.map((f) => ({ name: `pkg-v1/${f.path}`, content: f.content })));
const sha = (b: Buffer) => `sha256:${createHash("sha256").update(b).digest("hex")}`;

const SOURCE_ARCHIVE = archiveOf(withId(readHostedClawPackageFixture("seo"), "@opengroow/source"));
const OTHER_ARCHIVE = archiveOf(withId(readHostedClawPackageFixture("seo"), "@opengroow/seo"));

// The release pinned in the product, as the code under test sees it.
const PINNED = vi.hoisted(() => ({ repository: "OpenGroow/source", tag: "v1.0.0", digest: "" }));
vi.mock("@opengroow/agent-templates/pinned-source", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@opengroow/agent-templates/pinned-source")>()),
  PINNED_SOURCE_RELEASE: PINNED,
}));
PINNED.digest = sha(SOURCE_ARCHIVE);

const ARCHIVE_URL = "https://github.com/OpenGroow/source/archive/refs/tags/v1.0.0.tar.gz";
const PROJECT = "openclaw-boot-1";

const modules = {
  "../_generated/api.ts": () => import("../_generated/api.js"),
  "../source_bootstrap.ts": () => import("../source_bootstrap.js"),
  "../source_bootstrap_node.ts": () => import("../source_bootstrap_node.js"),
  "../template_install_local.ts": () => import("../template_install_local.js"),
  "../project_agents_node.ts": () => import("../project_agents_node.js"),
  "../project_agents.ts": () => import("../project_agents.js"),
  "../project_templates.ts": () => import("../project_templates.js"),
  "../instances.ts": () => import("../instances.js"),
};

/** The network: the index is never served (a 500 proves it is not consulted); only the given URLs answer. */
function stubNetwork(archives: Record<string, Buffer>) {
  const fetchMock = vi.fn(async (url: string) => {
    const archive = archives[url];
    return archive ? new Response(new Uint8Array(archive)) : new Response(null, { status: 500 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

async function seedProject(t: ReturnType<typeof convexTest>, projectId = PROJECT) {
  const now = new Date().toISOString();
  await t.run(async (ctx) => {
    await insertInstance(ctx, {
      jobId: `job-${projectId}`,
      status: "running",
      runtimeStatus: "linked",
      runtimeReady: true,
      createdAt: now,
      openclawId: projectId,
      updatedAt: now,
      userId: "owner",
    });
  });
}

const installed = (t: ReturnType<typeof convexTest>) =>
  t.run(async (ctx) => (await ctx.db.query("installedTemplates").collect()).map(({ templateId, origin, version }) => ({ templateId, origin, version })));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("source bootstrap (#673)", () => {
  it("installs @opengroow/source from the pinned release, never reading the hub index", async () => {
    const fetchMock = stubNetwork({ [ARCHIVE_URL]: SOURCE_ARCHIVE });
    const t = convexTest(schema, modules);
    await seedProject(t);

    const result = await t.action(internal.source_bootstrap_node.bootstrap, { projectId: PROJECT });

    expect(result.status).toBe("installed");
    expect(await installed(t)).toEqual([expect.objectContaining({ templateId: "@opengroow/source", origin: "hub" })]);
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([ARCHIVE_URL]);
  });

  it("is idempotent: a Project that already has Source is left alone, without any download", async () => {
    const fetchMock = stubNetwork({ [ARCHIVE_URL]: SOURCE_ARCHIVE });
    const t = convexTest(schema, modules);
    await seedProject(t);
    await t.action(internal.source_bootstrap_node.bootstrap, { projectId: PROJECT });
    fetchMock.mockClear();

    const again = await t.action(internal.source_bootstrap_node.bootstrap, { projectId: PROJECT });

    expect(again).toEqual({ status: "already_installed" });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await installed(t)).toHaveLength(1);
  });

  it("refuses a release whose digest differs from the pinned one, installing nothing", async () => {
    stubNetwork({ [ARCHIVE_URL]: OTHER_ARCHIVE });
    const t = convexTest(schema, modules);
    await seedProject(t);

    const result = await t.action(internal.source_bootstrap_node.bootstrap, { projectId: PROJECT, attempt: 99 });

    expect(result).toEqual({ status: "error", errorMessage: expect.stringMatching(/Digest mismatch/) });
    expect(await installed(t)).toEqual([]);
  });

  it("does not throw when the hub is unreachable, and schedules a retry", async () => {
    vi.useFakeTimers();
    stubNetwork({});
    const t = convexTest(schema, modules);
    await seedProject(t);

    const result = await t.action(internal.source_bootstrap_node.bootstrap, { projectId: PROJECT });

    expect(result).toEqual({ status: "error", errorMessage: expect.stringMatching(/HTTP 500/) });
    const scheduled = await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
    expect(scheduled).toHaveLength(1);
    expect(scheduled[0]!.args).toEqual([{ projectId: PROJECT, attempt: 1 }]);
  });

  it("gives up after the last retry", async () => {
    stubNetwork({});
    const t = convexTest(schema, modules);
    await seedProject(t);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await t.action(internal.source_bootstrap_node.bootstrap, { projectId: PROJECT, attempt: 99 });

    expect(await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect())).toHaveLength(0);
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
});
