import { chmod, lstat, mkdir, mkdtemp, readFile, readlink, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { createPluginsWorkflow } = require("../docker/control-socket-plugins-workflow.js") as {
  createPluginsWorkflow: (options: {
    homeDir: string;
    resolveOpenClawPackageDir: () => string;
    log?: (message: string) => void;
  }) => {
    install: (body: unknown) => Promise<{
      status: number;
      body: { ok: boolean; error?: string; data?: { plugins: Array<{ id: string; changed: boolean }> } };
    }>;
  };
};

const tempDirs: string[] = [];
afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) await rm(dir, { recursive: true, force: true });
  }
});

async function setup(config?: Record<string, unknown>) {
  const homeDir = await mkdtemp(path.join(tmpdir(), "openclaw-plugins-"));
  tempDirs.push(homeDir);
  await mkdir(path.join(homeDir, ".openclaw"), { recursive: true });
  if (config) await writeFile(path.join(homeDir, ".openclaw", "openclaw.json"), JSON.stringify(config));
  const workflow = createPluginsWorkflow({
    homeDir,
    resolveOpenClawPackageDir: () => "/usr/local/lib/node_modules/openclaw",
  });
  const extensionsDir = path.join(homeDir, ".openclaw", "extensions");
  const readConfig = async () =>
    JSON.parse(await readFile(path.join(homeDir, ".openclaw", "openclaw.json"), "utf8")) as Record<string, unknown>;
  return { workflow, extensionsDir, readConfig };
}

const plugin = (id = "my-plugin", entry = "export default 1;\n") => ({
  id,
  files: [
    { path: "package.json", content: JSON.stringify({ name: id, openclaw: { extensions: ["./dist/index.js"] } }) },
    { path: "openclaw.plugin.json", content: JSON.stringify({ id }) },
    { path: "dist/index.js", content: entry },
  ],
});

describe("control-socket plugins install (#661)", () => {
  it("installs even when opengroow/ is owned by another user (the worker's credential store, 0700 root)", async () => {
    const { workflow, extensionsDir } = await setup();
    const homeDir = path.dirname(path.dirname(extensionsDir));
    const opengroowDir = path.join(homeDir, ".openclaw", "opengroow");
    await mkdir(opengroowDir, { mode: 0o000 });
    try {
      const result = await workflow.install({ plugins: [plugin()] });
      expect(result.body.ok).toBe(true);
    } finally {
      await chmod(opengroowDir, 0o700);
    }
  });

  it("writes the plugin into the extensions dir and links openclaw for its SDK imports", async () => {
    const { workflow, extensionsDir } = await setup();

    const result = await workflow.install({ plugins: [plugin()] });

    expect(result).toEqual({ status: 200, body: { ok: true, data: { plugins: [{ id: "my-plugin", changed: true }] } } });
    expect(await readFile(path.join(extensionsDir, "my-plugin", "dist", "index.js"), "utf8")).toBe("export default 1;\n");
    const link = path.join(extensionsDir, "my-plugin", "node_modules", "openclaw");
    expect((await lstat(link)).isSymbolicLink()).toBe(true);
    expect(await readlink(link)).toBe("/usr/local/lib/node_modules/openclaw");
  });

  it("reports an identical reinstall as unchanged, so no gateway restart is needed", async () => {
    const { workflow } = await setup();
    await workflow.install({ plugins: [plugin()] });

    const again = await workflow.install({ plugins: [plugin()] });

    expect(again.body.data?.plugins).toEqual([{ id: "my-plugin", changed: false }]);
  });

  it("replaces a changed plugin entirely, dropping files it no longer ships", async () => {
    const { workflow, extensionsDir } = await setup();
    const first = plugin();
    first.files.push({ path: "dist/old.js", content: "old" });
    await workflow.install({ plugins: [first] });

    const result = await workflow.install({ plugins: [plugin("my-plugin", "export default 2;\n")] });

    expect(result.body.data?.plugins).toEqual([{ id: "my-plugin", changed: true }]);
    expect(await readFile(path.join(extensionsDir, "my-plugin", "dist", "index.js"), "utf8")).toBe("export default 2;\n");
    await expect(lstat(path.join(extensionsDir, "my-plugin", "dist", "old.js"))).rejects.toThrow();
  });


  it("reinstalls an unchanged plugin whose folder disappeared (reprovisioned volume)", async () => {
    const { workflow, extensionsDir } = await setup();
    await workflow.install({ plugins: [plugin()] });
    await rm(path.join(extensionsDir, "my-plugin"), { recursive: true });

    const result = await workflow.install({ plugins: [plugin()] });

    expect(result.body.data?.plugins).toEqual([{ id: "my-plugin", changed: true }]);
  });

  it("reinstalls an unchanged plugin whose openclaw link no longer points at the installed package", async () => {
    const { workflow, extensionsDir } = await setup();
    await workflow.install({ plugins: [plugin()] });
    const link = path.join(extensionsDir, "my-plugin", "node_modules", "openclaw");
    await rm(link);
    await symlink("/old/location/openclaw", link);

    const result = await workflow.install({ plugins: [plugin()] });

    expect(result.body.data?.plugins).toEqual([{ id: "my-plugin", changed: true }]);
    expect(await readlink(link)).toBe("/usr/local/lib/node_modules/openclaw");
  });

  it("adds the plugin to an existing plugins.allow list, once, keeping the rest of the config", async () => {
    const { workflow, readConfig } = await setup({ plugins: { allow: ["other"], entries: { x: {} } }, logging: { level: "info" } });

    await workflow.install({ plugins: [plugin()] });
    await workflow.install({ plugins: [plugin("my-plugin", "v2")] });

    expect(await readConfig()).toEqual({
      plugins: { allow: ["other", "my-plugin"], entries: { x: {} } },
      logging: { level: "info" },
    });
  });

  it("leaves the config alone when there is no allow list (everything discovered may load)", async () => {
    const { workflow, readConfig } = await setup({ logging: { level: "info" } });

    await workflow.install({ plugins: [plugin()] });

    expect(await readConfig()).toEqual({ logging: { level: "info" } });
  });

  it.each([
    ["no plugins", { plugins: [] }],
    ["a missing list", {}],
    ["an unsafe id", { plugins: [plugin("../evil")] }],
    ["an escaping file path", { plugins: [{ id: "p", files: [{ path: "../x.js", content: "" }] }] }],
    ["an absolute file path", { plugins: [{ id: "p", files: [{ path: "/etc/x.js", content: "" }] }] }],
    ["a file under node_modules/", { plugins: [{ id: "p", files: [{ path: "node_modules/openclaw/x.js", content: "" }] }] }],
    ["a non-string content", { plugins: [{ id: "p", files: [{ path: "a.js", content: 1 }] }] }],
  ])("refuses %s without writing anything", async (_name, body) => {
    const { workflow, extensionsDir } = await setup();

    const result = await workflow.install(body);

    expect(result.status).toBe(400);
    expect(result.body.ok).toBe(false);
    await expect(lstat(extensionsDir)).rejects.toThrow();
  });
});
