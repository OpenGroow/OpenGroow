/**
 * OpenClaw plugins shipped in a Template package (issue #661, ADR-055).
 *
 * A package may carry plugins under `plugins/<id>/`, each a complete OpenClaw
 * plugin folder (`package.json` declaring `openclaw.extensions`,
 * `openclaw.plugin.json`, the built entry). Pure and I/O free so it runs in
 * Convex and in the codegen: files in, validated plugins or an explicit
 * reason out.
 */
import type { TemplatePlugin } from "./types";

const PLUGINS_DIR = "plugins/";
/**
 * Plugin ids are folder names under the Instance's extensions dir: keep them
 * boring. The limits below mirror the control socket's own checks
 * (`control-socket-plugins-workflow.js`), so a package it would refuse is
 * refused here first.
 */
const PLUGIN_ID_RE = /^[a-z0-9][a-z0-9._-]{0,127}$/;
const MAX_FILES_PER_PLUGIN = 500;
/** A plugin travels in one runtime command: bound it well under the transport limits. */
export const MAX_PLUGIN_BYTES = 512 * 1024;

export type PluginsResult = { ok: true; plugins: TemplatePlugin[] } | { ok: false; reason: string };

const fail = (reason: string): { ok: false; reason: string } => ({ ok: false, reason });
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function parseJson(path: string, source: string | undefined): { ok: true; value: Record<string, unknown> } | { ok: false; reason: string } {
  if (source === undefined) return fail(`${path} is missing`);
  try {
    const value: unknown = JSON.parse(source);
    return isRecord(value) ? { ok: true, value } : fail(`${path} must be a JSON object`);
  } catch {
    return fail(`${path} is not valid JSON`);
  }
}

function checkPlugin(dir: string, files: Map<string, string>): string | undefined {
  const base = `${PLUGINS_DIR}${dir}`;
  const meta = parseJson(`${base}/openclaw.plugin.json`, files.get("openclaw.plugin.json"));
  if (!meta.ok) return meta.reason;
  if (meta.value.id !== dir) {
    return `${base}/openclaw.plugin.json declares id ${JSON.stringify(meta.value.id)}, which must match its folder name "${dir}"`;
  }
  const pkg = parseJson(`${base}/package.json`, files.get("package.json"));
  if (!pkg.ok) return pkg.reason;
  const extensions = isRecord(pkg.value.openclaw) ? pkg.value.openclaw.extensions : undefined;
  if (!Array.isArray(extensions) || extensions.length === 0 || !extensions.every((e) => typeof e === "string" && e.length > 0)) {
    return `${base}/package.json must declare "openclaw.extensions" (a non-empty list of entry files), or OpenClaw will not discover the plugin`;
  }
  if (files.size > MAX_FILES_PER_PLUGIN) return `${base} has ${files.size} files, over the ${MAX_FILES_PER_PLUGIN} limit`;
  let bytes = 0;
  for (const content of files.values()) bytes += new TextEncoder().encode(content).length;
  if (bytes > MAX_PLUGIN_BYTES) return `${base} is ${bytes} bytes, over the ${MAX_PLUGIN_BYTES / 1024} KiB limit`;
  return undefined;
}

/** The plugins of a package, from its files keyed by path relative to the package root. */
export function collectTemplatePlugins(packageFiles: Record<string, string>): PluginsResult {
  const byDir = new Map<string, Map<string, string>>();
  for (const [path, content] of Object.entries(packageFiles)) {
    if (!path.startsWith(PLUGINS_DIR)) continue;
    const rest = path.slice(PLUGINS_DIR.length);
    const slash = rest.indexOf("/");
    if (slash <= 0) return fail(`${path}: a plugin file must live in a plugin folder, plugins/<id>/...`);
    const dir = rest.slice(0, slash);
    const relative = rest.slice(slash + 1);
    if (!PLUGIN_ID_RE.test(dir)) {
      return fail(`${PLUGINS_DIR}${dir}: plugin id must match ${PLUGIN_ID_RE} (lowercase letters, digits, ".", "_", "-")`);
    }
    if (relative.split("/").some((segment) => segment === "" || segment === "." || segment === "..") || relative.includes("\\")) {
      return fail(`${path}: path escapes or is not normalized`);
    }
    if (relative.split("/")[0] === "node_modules") {
      return fail(`${path}: a plugin cannot ship node_modules/, the Instance links its OpenClaw SDK there`);
    }
    let files = byDir.get(dir);
    if (!files) byDir.set(dir, (files = new Map()));
    files.set(relative, content);
  }

  const plugins: TemplatePlugin[] = [];
  for (const dir of [...byDir.keys()].sort()) {
    const files = byDir.get(dir)!;
    const problem = checkPlugin(dir, files);
    if (problem) return fail(problem);
    plugins.push({
      id: dir,
      files: [...files.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([path, content]) => ({ path, content })),
    });
  }
  return { ok: true, plugins };
}
