import { mkdtemp, mkdir, readFile, realpath, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  isAllowedWorkspaceFilePath,
  isAllowedReadableWorkspaceFilePath,
  isAllowedDeletableWorkspaceFilePath,
  listWorkspaces,
  findWorkspace,
  listSkillFiles,
  createWorkspace,
  readWorkspaceFile,
  writeWorkspaceFile,
} = require("../docker/control-socket-workspaces.js") as {
  isAllowedWorkspaceFilePath: (filePath: string) => boolean;
  isAllowedReadableWorkspaceFilePath: (filePath: string) => boolean;
  isAllowedDeletableWorkspaceFilePath: (filePath: string) => boolean;
  listWorkspaces: (options: { homeDir: string; profileName?: string }) => Promise<{
    workspaces: Array<{
      workspaceKey: string;
      label?: string;
      kind?: string;
      absolutePath: string;
      isActive: boolean;
      availableFiles: Array<{ filePath: string }>;
    }>;
  }>;
  findWorkspace: (
    workspaceKey: string,
    options: { homeDir: string; profileName?: string },
  ) => Promise<{ workspaceKey: string; absolutePath: string }>;
  listSkillFiles: (
    workspacePath: string,
    spec: string,
  ) => Promise<Array<{ filePath: string; title: string; kind: string }>>;
  createWorkspace: (
    input: { workspaceKey: string; label?: string },
    options: { homeDir: string; profileName?: string },
  ) => Promise<{
    workspaceKey: string;
    label: string;
    absolutePath: string;
  }>;
  readWorkspaceFile: (
    input: { workspaceKey: string; filePath: string },
    options: { homeDir: string; profileName?: string },
  ) => Promise<{
    filePath: string;
    content: string;
  }>;
  writeWorkspaceFile: (
    input: { workspaceKey: string; filePath: string; content: string },
    options: { homeDir: string; profileName?: string },
  ) => Promise<{
    workspaceKey: string;
    filePath: string;
  }>;
};

const tempDirs: string[] = [];

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      await import("node:fs/promises").then(({ rm }) =>
        rm(dir, { recursive: true, force: true }),
      );
    }
  }
});

async function createTempHome() {
  const dir = await mkdtemp(path.join(tmpdir(), "openclaw-workspaces-"));
  tempDirs.push(dir);
  return dir;
}

describe("control-socket workspace helpers", () => {
  it("detects the configured active workspace and standard files", async () => {
    const homeDir = await createTempHome();
    const openclawDir = path.join(homeDir, ".openclaw");
    const activeWorkspace = path.join(openclawDir, "workspace-ops");

    await mkdir(activeWorkspace, { recursive: true });
    await writeFile(
      path.join(openclawDir, "openclaw.json"),
      JSON.stringify({ agent: { workspace: activeWorkspace } }),
      "utf8",
    );
    await writeFile(path.join(activeWorkspace, "AGENTS.md"), "# Agents", "utf8");
    await writeFile(
      path.join(activeWorkspace, "create_article.md"),
      "# Create article tools",
      "utf8",
    );
    await mkdir(path.join(activeWorkspace, "memory"), { recursive: true });
    await writeFile(
      path.join(activeWorkspace, "memory", "2026-04-29.md"),
      "# Memory",
      "utf8",
    );

    const result = await listWorkspaces({ homeDir, profileName: "default" });

    expect(result.workspaces).toHaveLength(1);
    expect(result.workspaces[0]?.isActive).toBe(true);
    expect(result.workspaces[0]?.absolutePath).toBe(await realpath(activeWorkspace));
    expect(result.workspaces[0]?.availableFiles.map((file) => file.filePath)).toEqual([
      "AGENTS.md",
      "create_article.md",
      "memory/2026-04-29.md",
    ]);

    await expect(
      readWorkspaceFile(
        {
          workspaceKey: result.workspaces[0]!.workspaceKey,
          filePath: "create_article.md",
        },
        { homeDir, profileName: "default" },
      ),
    ).resolves.toMatchObject({ content: "# Create article tools" });
  });

  it("deduplicates detected workspaces and reads allowed markdown files", async () => {
    const homeDir = await createTempHome();
    const openclawDir = path.join(homeDir, ".openclaw");
    const defaultWorkspace = path.join(openclawDir, "workspace");
    const profileWorkspace = path.join(openclawDir, "workspace-product");

    await mkdir(defaultWorkspace, { recursive: true });
    await mkdir(profileWorkspace, { recursive: true });
    await writeFile(path.join(defaultWorkspace, "AGENTS.md"), "# Default", "utf8");
    await writeFile(path.join(profileWorkspace, "USER.md"), "# Product", "utf8");

    const result = await listWorkspaces({ homeDir, profileName: "default" });

    expect(result.workspaces).toHaveLength(2);
    const defaultEntry = result.workspaces.find((entry) =>
      entry.absolutePath.endsWith("/workspace"),
    );
    expect(defaultEntry).toBeTruthy();

    const file = await readWorkspaceFile(
      {
        workspaceKey: defaultEntry!.workspaceKey,
        filePath: "AGENTS.md",
      },
      { homeDir, profileName: "default" },
    );

    expect(file.filePath).toBe("AGENTS.md");
    expect(file.content).toBe("# Default");
  });

  it("creates a managed workspace and writes agent template files", async () => {
    const homeDir = await createTempHome();

    const workspace = await createWorkspace(
      { workspaceKey: "seo-agent", label: "SEO Agent" },
      { homeDir, profileName: "default" },
    );

    expect(workspace.workspaceKey).toBe("seo-agent");
    expect(workspace.label).toBe("SEO Agent");
    expect(workspace.absolutePath).toBe(
      await realpath(path.join(homeDir, ".openclaw", "workspace-seo-agent")),
    );

    const written = await writeWorkspaceFile(
      { workspaceKey: "seo-agent", filePath: "AGENTS.md", content: "# Agents" },
      { homeDir, profileName: "default" },
    );

    expect(written).toEqual({ workspaceKey: "seo-agent", filePath: "AGENTS.md" });
    await expect(
      readFile(path.join(workspace.absolutePath, "AGENTS.md"), "utf8"),
    ).resolves.toBe("# Agents");

    const listed = await listWorkspaces({ homeDir, profileName: "default" });
    const listedWorkspace = listed.workspaces.find(
      (entry) => entry.workspaceKey === "seo-agent",
    );
    expect(listedWorkspace?.kind).toBe("managed");
    expect(listedWorkspace?.availableFiles).toEqual([
      { filePath: "AGENTS.md", title: "agents", kind: "standard" },
    ]);
  });


  it("validates the workspace allowlist and rejects traversal", async () => {
    expect(isAllowedWorkspaceFilePath("AGENTS.md")).toBe(true);
    expect(isAllowedWorkspaceFilePath("create_article.md")).toBe(true);
    expect(isAllowedWorkspaceFilePath("nested/create_article.md")).toBe(true);
    expect(isAllowedWorkspaceFilePath("mission files/create article.md")).toBe(true);
    expect(isAllowedWorkspaceFilePath("_internal.md")).toBe(true);
    expect(isAllowedWorkspaceFilePath("version..md")).toBe(true);
    expect(isAllowedWorkspaceFilePath("nested/AGENTS.md")).toBe(true);
    expect(isAllowedWorkspaceFilePath("TOOLS.md")).toBe(false);
    expect(isAllowedWorkspaceFilePath("tools.md")).toBe(false);
    expect(isAllowedWorkspaceFilePath("agents.md")).toBe(false);
    expect(isAllowedWorkspaceFilePath("memory/2026-04-29.md")).toBe(true);
    expect(isAllowedWorkspaceFilePath("skills/foo.md")).toBe(false);
    expect(isAllowedWorkspaceFilePath("skills/foo/SKILL.md")).toBe(false);
    expect(isAllowedWorkspaceFilePath("skills/foo/scripts/run.sh")).toBe(false);
    expect(isAllowedWorkspaceFilePath("skills/../AGENTS.md")).toBe(false);
    expect(isAllowedWorkspaceFilePath(".git/instructions.md")).toBe(false);
    expect(isAllowedWorkspaceFilePath("node_modules/instructions.md")).toBe(false);
    expect(isAllowedWorkspaceFilePath(" create_article.md")).toBe(false);
    expect(isAllowedWorkspaceFilePath("../AGENTS.md")).toBe(false);
    expect(isAllowedWorkspaceFilePath("memory/not-a-date.md")).toBe(false);
  });

  it("isAllowedReadableWorkspaceFilePath additionally allows skill files but not writes/deletes", () => {
    expect(isAllowedReadableWorkspaceFilePath("AGENTS.md")).toBe(true);
    expect(isAllowedReadableWorkspaceFilePath("skills/foo.md")).toBe(false);
    expect(isAllowedReadableWorkspaceFilePath("skills/foo/SKILL.md")).toBe(true);
    expect(isAllowedReadableWorkspaceFilePath("skills/foo/scripts/run.sh")).toBe(true);
    expect(isAllowedReadableWorkspaceFilePath("skills/../AGENTS.md")).toBe(false);
  });

  it("lets a SourceJob's result be read, never written, and its run files be deleted", () => {
    const result = "jobs/job1/outputs/run1.json";
    const runFile = "jobs/job1/run.md";
    // read: the Agent writes the result itself, OpenGroow only reads it
    expect(isAllowedReadableWorkspaceFilePath(result)).toBe(true);
    expect(isAllowedWorkspaceFilePath(result)).toBe(false);
    // the run file is written by OpenGroow before the exec
    expect(isAllowedWorkspaceFilePath(runFile)).toBe(true);
    // cleanup once the job settles
    expect(isAllowedDeletableWorkspaceFilePath(result)).toBe(true);
    expect(isAllowedDeletableWorkspaceFilePath(runFile)).toBe(true);
    // ordinary rules: the deletable set is a superset of the writable one only
    expect(isAllowedDeletableWorkspaceFilePath("AGENTS.md")).toBe(true);
    expect(isAllowedDeletableWorkspaceFilePath("skills/foo/SKILL.md")).toBe(false);
  });

  it("refuses traversal and any other path under jobs/, and the old runs/ results", () => {
    for (const bad of [
      "jobs/job1/secrets.json",
      "jobs/job1/outputs/nested/run1.json",
      "jobs/../outputs/run1.json",
      "jobs/job1/../../AGENTS.md",
      "jobs/outputs/run1.json",
      "jobs//outputs/run1.json",
      "runs/run1/outputs/run1.json",
      "/jobs/job1/run.md",
    ]) {
      expect(isAllowedReadableWorkspaceFilePath(bad)).toBe(false);
      expect(isAllowedDeletableWorkspaceFilePath(bad)).toBe(false);
      expect(isAllowedWorkspaceFilePath(bad)).toBe(false);
    }
  });

  it("rejects symlinked workspace files", async () => {
    const homeDir = await createTempHome();
    const openclawDir = path.join(homeDir, ".openclaw");
    const workspaceDir = path.join(openclawDir, "workspace");
    const outsideFile = path.join(homeDir, "outside.md");

    await mkdir(workspaceDir, { recursive: true });
    await writeFile(outsideFile, "# Outside", "utf8");
    await symlink(outsideFile, path.join(workspaceDir, "AGENTS.md"));

    const result = await listWorkspaces({ homeDir, profileName: "default" });
    const workspaceKey = result.workspaces[0]?.workspaceKey;
    expect(workspaceKey).toBeTruthy();

    await expect(
      readWorkspaceFile(
        {
          workspaceKey: workspaceKey!,
          filePath: "AGENTS.md",
        },
        { homeDir, profileName: "default" },
      ),
    ).rejects.toThrow(/symlink/i);
  });

  it("lists a skill's files on demand, resolving namespaced specs by their leaf name", async () => {
    const homeDir = await createTempHome();
    const workspace = await createWorkspace(
      { workspaceKey: "seo-agent", label: "SEO Agent" },
      { homeDir, profileName: "default" },
    );
    const skillDir = path.join(workspace.absolutePath, "skills", "avoid-ai-writing");
    await mkdir(path.join(skillDir, "scripts"), { recursive: true });
    await writeFile(path.join(skillDir, "SKILL.md"), "# Skill", "utf8");
    await writeFile(path.join(skillDir, "scripts", "check.sh"), "#!/bin/sh", "utf8");

    const files = await listSkillFiles(workspace.absolutePath, "cubic/avoid-ai-writing");

    expect(files).toEqual([
      {
        filePath: "skills/avoid-ai-writing/scripts/check.sh",
        title: "check",
        kind: "skill",
      },
      { filePath: "skills/avoid-ai-writing/SKILL.md", title: "SKILL", kind: "skill" },
    ]);

    const workspaceEntry = await findWorkspace("seo-agent", { homeDir, profileName: "default" });
    const file = await readWorkspaceFile(
      { workspaceKey: workspaceEntry.workspaceKey, filePath: "skills/avoid-ai-writing/SKILL.md" },
      { homeDir, profileName: "default" },
    );
    expect(file.content).toBe("# Skill");
  });

  it("returns an empty list for a skill folder that does not exist", async () => {
    const homeDir = await createTempHome();
    const workspace = await createWorkspace(
      { workspaceKey: "seo-agent", label: "SEO Agent" },
      { homeDir, profileName: "default" },
    );

    await expect(listSkillFiles(workspace.absolutePath, "missing-skill")).resolves.toEqual([]);
  });

  it("rejects writes through symlinked workspace files", async () => {
    const homeDir = await createTempHome();
    const workspace = await createWorkspace(
      { workspaceKey: "seo-agent", label: "SEO Agent" },
      { homeDir, profileName: "default" },
    );
    const outsideFile = path.join(homeDir, "outside.md");

    await writeFile(outsideFile, "# Outside", "utf8");
    await symlink(outsideFile, path.join(workspace.absolutePath, "AGENTS.md"));

    await expect(
      writeWorkspaceFile(
        {
          workspaceKey: "seo-agent",
          filePath: "AGENTS.md",
          content: "# Updated",
        },
        { homeDir, profileName: "default" },
      ),
    ).rejects.toThrow(/symlink/i);
  });
});
