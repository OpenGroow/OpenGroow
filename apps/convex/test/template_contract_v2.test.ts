import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import { isTemplateVersionRunnable } from "@opengroow/agent-templates";
import schema from "../schema";
import { getTemplateRegistry } from "../template_registry";
import { installTemplatePackage, offerTemplateUpdate } from "../template_registry_store";
import { storeOutdatedVersion } from "./helpers/outdated_version";
import { collectTemplateWorkspaceFiles } from "../project_agents/template_workspace_files";
import {
  readClawPackageFixture,
  withFile,
  type PackageFile,
} from "../../../packages/agent-templates/src/__fixtures__/claw-package";

// Template contract v2 (ADR-091): Bundled Recipes travel with every install, and a stored version 1 keeps resolving.
const PROJECT = "openclaw-contract-v2";
const modules = { "../_generated/api.ts": () => import("../_generated/api.js") };

const studio = (version = "1.0.0"): PackageFile[] =>
  withFile(readClawPackageFixture("studio"), "package.json", JSON.stringify({ name: "@acme/studio", version, openclaw: { claw: "CLAW.md" } }));
const legacy = (): PackageFile[] => readClawPackageFixture("legacy");

const install = (t: ReturnType<typeof convexTest>, files: PackageFile[], origin: "folder" | "hub" | "linked_folder" | "git" | "local_folder") =>
  t.run((ctx) => installTemplatePackage(ctx, { projectId: PROJECT, files, origin: origin as never }));
const resolve = (t: ReturnType<typeof convexTest>, templateId: string, version?: string) =>
  t.run((ctx) => getTemplateRegistry(ctx).resolve(PROJECT, templateId, version));

describe("installing a version 2 package", () => {
  it.each(["local_folder", "linked_folder", "hub", "git"] as const)("carries the Bundled Recipes with a %s install", async (origin) => {
    const t = convexTest(schema, modules);
    await install(t, studio(), origin);
    const template = await resolve(t, "@acme/studio");
    expect(template?.recipes?.map((r) => [r.missionType, r.id, r.default])).toEqual([
      ["write_post", "freeform", true],
      ["write_post", "punchy", false],
    ]);
    expect(isTemplateVersionRunnable(template!.manifest)).toBe(true);
  });

  it("does not copy the recipe files to the Agent workspace", async () => {
    const t = convexTest(schema, modules);
    await install(t, studio(), "local_folder");
    const template = (await resolve(t, "@acme/studio"))!;
    const workspace = collectTemplateWorkspaceFiles(template);
    expect([...workspace.keys()].sort()).toEqual(["AGENTS.md", "moderate.md", "write_post.md"]);
    expect([...workspace.values()].join("\n")).not.toContain("Punchy");
  });

  it("refuses a package with a missing recipe file, storing nothing", async () => {
    const t = convexTest(schema, modules);
    const broken = studio().filter((f) => f.path !== "recipes/write_post/punchy.yml");
    await expect(install(t, broken, "local_folder")).rejects.toThrow(/recipes\/write_post\/punchy\.yml/);
    expect(await resolve(t, "@acme/studio")).toBeFalsy();
  });
});

describe("installing a version 1 package", () => {
  it.each(["local_folder", "linked_folder", "hub", "git"] as const)("refuses a %s install with the way out, storing nothing", async (origin) => {
    const t = convexTest(schema, modules);
    await expect(install(t, legacy(), origin)).rejects.toThrow(/schemaVersion 1.*update it to schemaVersion 2/);
    expect(await resolve(t, "@acme/legacy")).toBeFalsy();
  });

  it("refuses it as an update offer, storing nothing", async () => {
    const t = convexTest(schema, modules);
    await t.run((ctx) => storeOutdatedVersion(ctx, { projectId: PROJECT, files: legacy() }));
    const update = withFile(legacy(), "package.json", JSON.stringify({ name: "@acme/legacy", version: "2.0.0", openclaw: { claw: "CLAW.md" } }));
    await expect(t.run((ctx) => offerTemplateUpdate(ctx, { projectId: PROJECT, files: update, origin: "hub" }))).rejects.toThrow(
      /update it to schemaVersion 2/,
    );
    expect(await resolve(t, "@acme/legacy", "2.0.0")).toBeFalsy();
  });
});

describe("stored versions", () => {
  it("still resolves a stored version 1, outdated, with its history readable", async () => {
    const t = convexTest(schema, modules);
    await t.run((ctx) => storeOutdatedVersion(ctx, { projectId: PROJECT, files: legacy() }));
    const template = await resolve(t, "@acme/legacy", "1.0.0");
    expect(template?.manifest.missionTypes?.map((m) => m.type)).toEqual(["write_post", "moderate"]);
    expect(template?.missionAgentsMd?.write_post).toContain("Write the post");
    expect(isTemplateVersionRunnable(template!.manifest)).toBe(false);
  });

  it("refuses a version this deployment does not know, leaving the current version untouched", async () => {
    const t = convexTest(schema, modules);
    await install(t, studio("1.0.0"), "local_folder");
    const profile = studio("2.0.0").find((f) => f.path === "profiles/opengroow.yml")!.content;
    const future = withFile(studio("2.0.0"), "profiles/opengroow.yml", profile.replace("schemaVersion: 2", "schemaVersion: 3"));
    await expect(install(t, future, "hub")).rejects.toThrow(/unsupported schemaVersion 3/);
    const current = await resolve(t, "@acme/studio");
    expect(current?.recipes).toHaveLength(2);
    expect(await resolve(t, "@acme/studio", "2.0.0")).toBeFalsy();
  });
});
