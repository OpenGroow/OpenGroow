const crypto = require("node:crypto");
const fsPromises = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { readOpenClawConfig, writeOpenClawConfig } = require("./control-socket-mcp");
const { resolveOpenClawPackageDir: resolveOpenClawPackageDirShared } = require("./control-socket-openclaw");

/**
 * Installs OpenClaw plugins declared by a Template into the Instance at run
 * time (issue #661), replacing the plugin that used to be baked into the
 * image. The plugin is copied into `<home>/.openclaw/extensions/<id>/`, where
 * OpenClaw discovers it (its package.json declares `openclaw.extensions`), and
 * `node_modules/openclaw` is linked to the globally installed package so the
 * plugin's `openclaw/plugin-sdk/*` imports resolve.
 *
 * A running Gateway only sees installed plugin code after a restart: this
 * workflow reports which plugins actually changed and leaves the restart to the
 * caller, who knows when it is safe (nothing else may talk to the Instance
 * while it restarts).
 */

const PLUGIN_ID_RE = /^[a-z0-9][a-z0-9._-]{0,127}$/;
const MAX_FILES_PER_PLUGIN = 500;

class InvalidPluginsError extends Error {}

function normalizePlugins(body) {
  const plugins = body && typeof body === "object" ? body.plugins : undefined;
  if (!Array.isArray(plugins) || plugins.length === 0) {
    throw new InvalidPluginsError("plugins is required and must be a non-empty array");
  }
  const seen = new Set();
  return plugins.map((plugin) => {
    const id = plugin && typeof plugin === "object" ? plugin.id : undefined;
    if (typeof id !== "string" || !PLUGIN_ID_RE.test(id)) {
      throw new InvalidPluginsError(`Invalid plugin id: ${JSON.stringify(id)}`);
    }
    if (seen.has(id)) throw new InvalidPluginsError(`Duplicate plugin id: ${id}`);
    seen.add(id);
    const files = plugin.files;
    if (!Array.isArray(files) || files.length === 0 || files.length > MAX_FILES_PER_PLUGIN) {
      throw new InvalidPluginsError(`Plugin ${id}: files must be a non-empty array (at most ${MAX_FILES_PER_PLUGIN})`);
    }
    const normalized = files.map((file) => {
      const filePath = file && typeof file === "object" ? file.path : undefined;
      if (typeof filePath !== "string" || typeof file.content !== "string") {
        throw new InvalidPluginsError(`Plugin ${id}: each file needs a string path and content`);
      }
      const segments = filePath.split("/");
      if (
        filePath.includes("\\") ||
        filePath.includes("\0") ||
        path.isAbsolute(filePath) ||
        segments.some((segment) => segment === "" || segment === "." || segment === "..") ||
        segments[0] === "node_modules"
      ) {
        throw new InvalidPluginsError(`Plugin ${id}: unsafe file path ${JSON.stringify(filePath)}`);
      }
      return { path: filePath, content: file.content };
    });
    return { id, files: normalized };
  });
}

function digestOf(files) {
  const hash = crypto.createHash("sha256");
  for (const file of [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))) {
    hash.update(JSON.stringify([file.path, file.content]));
  }
  return hash.digest("hex");
}

async function readIfExists(file) {
  try {
    return (await fsPromises.readFile(file, "utf8")).trim();
  } catch (error) {
    if (error && error.code === "ENOENT") return undefined;
    throw error;
  }
}

async function readLinkIfExists(file) {
  try {
    return await fsPromises.readlink(file);
  } catch (error) {
    if (error && (error.code === "ENOENT" || error.code === "EINVAL")) return undefined;
    throw error;
  }
}

async function exists(file) {
  try {
    await fsPromises.lstat(file);
    return true;
  } catch (error) {
    if (error && error.code === "ENOENT") return false;
    throw error;
  }
}

function createPluginsWorkflow(options = {}) {
  const homeDir = options.homeDir?.trim() || process.env.HOME?.trim() || os.homedir();
  const log = options.log ?? (() => {});
  const resolveOpenClawPackageDir = options.resolveOpenClawPackageDir ?? resolveOpenClawPackageDirShared;
  const configOptions = { homeDir };
  const openClawDir = path.join(homeDir, ".openclaw");
  const extensionsDir = path.join(openClawDir, "extensions");
  // Not under `opengroow/`: the runtime worker (root) creates that directory
  // 0700 to store delivered credentials, after which this workflow (node)
  // could no longer create anything in it (EACCES). Same volume as
  // `extensions/`, so the staging rename stays atomic.
  const stateDir = path.join(openClawDir, "opengroow-plugins");

  async function installOne({ id, files }, openClawPackageDir) {
    const target = path.join(extensionsDir, id);
    const digestFile = path.join(stateDir, `${id}.sha256`);
    const digest = digestOf(files);
    const storedDigest = await readIfExists(digestFile);
    // Unchanged only when the files match AND the SDK link still points at the
    // installed OpenClaw: an image update that moves the global package would
    // otherwise leave a plugin that silently fails to load.
    if (
      storedDigest === digest &&
      (await exists(path.join(target, "package.json"))) &&
      (await readLinkIfExists(path.join(target, "node_modules", "openclaw"))) === openClawPackageDir
    ) {
      // Migrate a digest found only under the old name.
      if ((await readIfExists(digestFile)) === undefined) {
        await fsPromises.writeFile(digestFile, `${digest}\n`, "utf8");
      }
      return false;
    }

    // Built beside the target (same volume) and renamed into place, so the
    // Gateway never discovers a half-written plugin. Unique per call: two
    // overlapping reconciliations must not share a staging dir.
    const staging = path.join(stateDir, `${id}.staging-${crypto.randomUUID()}`);
    try {
      for (const file of files) {
        const destination = path.join(staging, file.path);
        await fsPromises.mkdir(path.dirname(destination), { recursive: true });
        await fsPromises.writeFile(destination, file.content, "utf8");
      }
      await fsPromises.mkdir(path.join(staging, "node_modules"), { recursive: true });
      await fsPromises.symlink(openClawPackageDir, path.join(staging, "node_modules", "openclaw"));

      await fsPromises.mkdir(extensionsDir, { recursive: true });
      await fsPromises.rm(target, { recursive: true, force: true });
      await fsPromises.rename(staging, target);
    } catch (error) {
      await fsPromises.rm(staging, { recursive: true, force: true });
      throw error;
    }
    await fsPromises.writeFile(digestFile, `${digest}\n`, "utf8");
    return true;
  }

  /** `plugins.allow` is an exclusive allowlist: a plugin outside it never loads. */
  async function allowPlugins(ids) {
    const config = await readOpenClawConfig(configOptions);
    const plugins = config.plugins;
    if (!plugins || typeof plugins !== "object" || !Array.isArray(plugins.allow)) return;
    const missing = ids.filter((id) => !plugins.allow.includes(id));
    if (missing.length === 0) return;
    config.plugins = { ...plugins, allow: [...plugins.allow, ...missing] };
    await writeOpenClawConfig(config, configOptions);
  }

  async function install(body = {}) {
    try {
      const plugins = normalizePlugins(body);
      await fsPromises.mkdir(stateDir, { recursive: true });
      const openClawPackageDir = resolveOpenClawPackageDir();
      const results = [];
      for (const plugin of plugins) {
        const changed = await installOne(plugin, openClawPackageDir);
        log(`plugin ${plugin.id}: ${changed ? "installed" : "already up to date"}`);
        results.push({ id: plugin.id, changed });
      }
      await allowPlugins(plugins.map((plugin) => plugin.id));
      return { status: 200, body: { ok: true, data: { plugins: results } } };
    } catch (error) {
      return {
        status: error instanceof InvalidPluginsError ? 400 : 500,
        body: { ok: false, error: error instanceof Error ? error.message : "Failed to install plugins" },
      };
    }
  }

  return { install };
}

module.exports = { createPluginsWorkflow };
