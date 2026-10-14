const { execFile } = require("node:child_process");
const fs = require("node:fs");

/**
 * Optional OpenClaw plugins (issues #638, #639): the image ships none of them.
 * The operator lists the ones an Instance needs in OPENCLAW_OPTIONAL_PLUGINS
 * (comma-separated ids) and the entrypoint reconciles the Instance with that
 * list on every start, before the Gateway runs, so no Gateway restart is ever
 * needed. The variable is the source of truth: an id that leaves the list is
 * uninstalled (for WhatsApp this also drops its channel config). The Dashboard
 * reads the same variable to hide what an Instance does not offer.
 */

const OPTIONAL_PLUGIN_PACKAGES = {
  codex: "@openclaw/codex",
  whatsapp: "@openclaw/whatsapp",
  xiaomi: "@openclaw/xiaomi-provider",
  groq: "@openclaw/groq-provider",
};

function parseOptionalPlugins(raw) {
  const enabled = [];
  const unknown = [];
  for (const part of (raw ?? "").split(",")) {
    const id = part.trim().toLowerCase();
    if (!id || enabled.includes(id) || unknown.includes(id)) continue;
    (Object.hasOwn(OPTIONAL_PLUGIN_PACKAGES, id) ? enabled : unknown).push(id);
  }
  return { enabled, unknown };
}

// A failed `openclaw` call can print dozens of lines (npm stack traces) behind
// an unrelated config warning: keep the first lines of the actual cause.
function summarizeFailure(message) {
  const lines = message.split("\n").map((line) => line.trim()).filter(Boolean);
  const cause = lines.filter((line) => !line.startsWith("[config] warnings:"));
  return (cause.length > 0 ? cause : lines).slice(0, 3).join(" | ");
}

// plugins.allow is an exclusive allowlist: a plugin outside it never loads. An
// absent list allows everything, so it is only edited when it already exists
// (the image seeds it), and never emptied (an empty list would block them all).
// Read once and written once, whatever the number of plugins: every `openclaw`
// call boots the whole CLI.
async function readAllowList(run) {
  try {
    const parsed = JSON.parse((await run(["config", "get", "plugins.allow", "--json"])) || "null");
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null; // plugins.allow is not set.
  }
}

async function writeAllowList(run, before, after) {
  if (!before || after.length === 0 || (after.length === before.length && after.every((id, i) => id === before[i]))) {
    return;
  }
  await run(["config", "set", "--json", "plugins.allow", JSON.stringify(after)]);
}

// What OpenClaw reports, not a file of ours: it stays right after an
// interrupted start, a recreated container or a plugin added by hand.
async function listInstalled(run) {
  const { plugins } = JSON.parse(await run(["plugins", "list", "--json"]));
  return new Map(
    plugins
      .filter((plugin) => plugin.origin !== "bundled" && Object.hasOwn(OPTIONAL_PLUGIN_PACKAGES, plugin.id))
      .map((plugin) => [plugin.id, plugin]),
  );
}

async function reconcileOptionalPlugins({ requested, version, run, log = () => {} }) {
  const { enabled, unknown } = parseOptionalPlugins(requested);
  for (const id of unknown) {
    log(`WARNING: unknown optional plugin "${id}" in OPENCLAW_OPTIONAL_PLUGINS — ignored`);
  }
  const installed = await listInstalled(run);
  const result = { installed: [], uninstalled: [], failed: [] };
  const allowBefore = await readAllowList(run);
  let allow = allowBefore ? [...allowBefore] : null;

  for (const id of [...installed.keys()].filter((entry) => !enabled.includes(entry))) {
    try {
      await run(["plugins", "uninstall", id, "--force"]);
      if (allow) allow = allow.filter((entry) => entry !== id);
      result.uninstalled.push(id);
      log(`✓ ${id} uninstalled (not in OPENCLAW_OPTIONAL_PLUGINS)`);
    } catch (error) {
      result.failed.push(id);
      log(`WARNING: failed to uninstall ${id}: ${summarizeFailure(error.message)}`);
    }
  }

  for (const id of enabled) {
    try {
      const existing = installed.get(id);
      if (!existing) {
        await run([
          "plugins",
          "install",
          `npm:${OPTIONAL_PLUGIN_PACKAGES[id]}@${version}`,
          "--accept-capabilities",
          "--force",
          "--pin",
        ]);
      }
      if (!existing || !existing.enabled) await run(["plugins", "enable", id]);
      if (allow && !allow.includes(id)) allow.push(id);
      if (!existing) {
        result.installed.push(id);
        log(`✓ ${id} installed`);
      }
    } catch (error) {
      result.failed.push(id);
      log(`WARNING: failed to install ${id}: ${summarizeFailure(error.message)}`);
    }
  }

  if (allow) {
    try {
      await writeAllowList(run, allowBefore, allow);
    } catch (error) {
      log(`WARNING: failed to update plugins.allow: ${summarizeFailure(error.message)}`);
    }
  }
  return result;
}

// A registry that hangs must not hold the Gateway start forever.
const COMMAND_TIMEOUT_MS = 5 * 60 * 1000;

function runOpenClaw(args) {
  return new Promise((resolve, reject) => {
    execFile(
      "openclaw",
      args,
      { maxBuffer: 16 * 1024 * 1024, timeout: COMMAND_TIMEOUT_MS },
      (error, stdout, stderr) => {
        if (error) reject(new Error(error.killed ? `timed out after ${COMMAND_TIMEOUT_MS / 1000}s` : stderr.trim() || error.message));
        else resolve(stdout);
      },
    );
  });
}

async function main() {
  const version = fs.readFileSync("/opt/openclaw-expected-version", "utf8").trim();
  await reconcileOptionalPlugins({
    requested: process.env.OPENCLAW_OPTIONAL_PLUGINS,
    version,
    run: runOpenClaw,
    log: (message) => console.log(`[entrypoint]   ${message}`),
  });
}

if (require.main === module) {
  // A failure here must not stop the Gateway from starting: the plugin simply
  // stays as it was and is reconciled again on the next start.
  main().catch((error) => console.error(`[entrypoint] WARNING: optional plugins: ${error.message}`));
}

module.exports = { OPTIONAL_PLUGIN_PACKAGES, parseOptionalPlugins, reconcileOptionalPlugins, summarizeFailure };
