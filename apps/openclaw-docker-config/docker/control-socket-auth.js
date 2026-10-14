const AUTH_SCREEN_BUFFER_MAX_LINES = 240;
const AUTH_WAITING_INPUT_ECHO_GRACE_MS = 1500;

// "openai" is OpenClaw's canonical provider id for OpenAI — both API-key
// auth and ChatGPT/Codex OAuth subscriptions resolve to it (see
// docs/concepts/oauth.md). Older "openai-codex" ids are legacy state that
// openclaw's own `doctor --fix` repairs to "openai"; do not reintroduce it.
//
// Mirrors OPENAI_CODEX_DEFAULT_MODEL from the openclaw CLI (openai/gpt-5.5
// as of 2026.6.9) — the model the CLI itself falls back to for a linked
// ChatGPT/Codex OAuth subscription. Kept here so handleAiConfig's
// api-key path and the OAuth completion path agree on the same value.
const AUTH_PROVIDER_DEFAULT_MODEL = {
  openai: "openai/gpt-5.5",
};

function defaultModelForAuthProvider(provider) {
  const normalized = typeof provider === "string" ? provider.trim() : "";
  return AUTH_PROVIDER_DEFAULT_MODEL[normalized] ?? null;
}

// A ChatGPT/Codex OAuth subscription resolves to the "openai" provider id,
// but the runtime routes it through the separate "codex" plugin (native
// Codex app-server runtime). `openclaw onboard`'s old guided flow used to
// allow+enable that plugin as a side effect of its bigger setup; the
// narrower `openclaw models auth login --provider openai --force` (#291)
// only creates the auth.profiles credential and does neither — leaving the
// plugin blocked by plugins.allow, so the linked model resolves fine via
// `openclaw models list` (live plugin discovery) but fails at inference
// with "Unknown model" (verified end-to-end against a live gateway).
const AUTH_PROVIDER_PLUGIN_ID = {
  openai: "codex",
};

function pluginIdForAuthProvider(provider) {
  const normalized = typeof provider === "string" ? provider.trim() : "";
  return AUTH_PROVIDER_PLUGIN_ID[normalized] ?? null;
}

// `openclaw models list` resolves a linked OAuth subscription's model via
// live plugin discovery, but real inference is stricter: it requires an
// explicit models.providers.<id>.models[] config entry, or it fails with
// "Unknown model ... Add { "id": ..., "name": ... } to
// models.providers[...].models[] to register this provider model."
// (confirmed against a live gateway — `openclaw models list` succeeding is
// not sufficient evidence the model actually works). handleAiConfig's
// api-key path always writes this catalog entry; the OAuth path never did.
// Derives the { id, name } pair straight from AUTH_PROVIDER_DEFAULT_MODEL's
// "provider/model" value so the two stay in sync by construction.
function modelCatalogEntryForAuthProvider(provider) {
  const model = defaultModelForAuthProvider(provider);
  if (!model) {
    return null;
  }
  const separatorIndex = model.indexOf("/");
  if (separatorIndex < 0) {
    return null;
  }
  const modelId = model.slice(separatorIndex + 1);
  return { id: modelId, name: modelId };
}

// `openclaw models auth list --provider <id> --json` reports each saved
// credential's store type ("api_key" | "oauth" | "token") — a different
// vocabulary from the config-side `auth.profiles.<id>.mode` string
// ("api-key") that handleAiConfig writes. This maps our dashboard's
// (provider, kind) Provider identity (see GLOSSARY.md, #280) to that store
// type so #289's same-provider auth-order switch can find the right saved
// profile id without guessing it ahead of time.
const AUTH_PROFILE_TYPES_BY_KIND = {
  apikey: ["api_key"],
  subscription: ["oauth", "token"],
};

// Given the saved profiles for one provider (from `models auth list --json`)
// and which kind of credential the dashboard wants active, finds that
// profile and returns an `auth.order.<provider>` list with it moved first —
// the rest keep their relative order as a failover chain. Returns null when
// no saved profile matches the requested kind (the caller must link/config
// it first).
function resolveAuthOrderTarget(profiles, kind) {
  const wantedTypes = AUTH_PROFILE_TYPES_BY_KIND[kind];
  if (!wantedTypes || !Array.isArray(profiles)) {
    return null;
  }
  const ids = profiles
    .map((profile) => (typeof profile?.id === "string" ? profile.id.trim() : ""))
    .filter(Boolean);
  const target = profiles.find(
    (profile) =>
      typeof profile?.id === "string" &&
      profile.id.trim() &&
      wantedTypes.includes(profile.type),
  );
  if (!target) {
    return null;
  }
  const targetId = target.id.trim();
  const rest = ids.filter((id) => id !== targetId);
  return { profileId: targetId, order: [targetId, ...rest] };
}

function stripAnsiTerminalCodes(text) {
  return String(text || "")
    .replace(/\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g, "")
    .replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, "")
    .replace(/\u001b[@-_]/g, "");
}

function normalizeTerminalScreenText(text) {
  return stripAnsiTerminalCodes(text)
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\n{3,}/g, "\n\n");
}

function appendRecentAuthScreen(current, nextChunk) {
  const normalizedCurrent = normalizeTerminalScreenText(current).trim();
  const normalizedNext = normalizeTerminalScreenText(nextChunk).trim();
  const merged = [normalizedCurrent, normalizedNext].filter(Boolean).join("\n");
  if (!merged) {
    return "";
  }
  const lines = merged.split("\n");
  return lines.slice(-AUTH_SCREEN_BUFFER_MAX_LINES).join("\n");
}

function isAuthWaitingInputMessage(output) {
  const text = String(output || "");
  return (
    text.includes("OAuth URL ready") ||
    text.includes("Open this URL") ||
    text.includes("Paste the authorization code") ||
    text.includes("Paste the redirect URL") ||
    text.includes("authorization code")
  );
}

function shouldTransitionAuthSessionToWaitingInput({
  output,
  authInputSubmittedAtMs = 0,
  now = Date.now(),
}) {
  if (!isAuthWaitingInputMessage(output)) {
    return false;
  }
  if (
    typeof authInputSubmittedAtMs === "number" &&
    authInputSubmittedAtMs > 0 &&
    now - authInputSubmittedAtMs < AUTH_WAITING_INPUT_ECHO_GRACE_MS
  ) {
    return false;
  }
  return true;
}

// Strict whitelist for provider ids reaching a real shell (see
// startInteractiveAuthSession's `script -c` transport, #291). OpenClaw
// provider ids are lowercase tokens (openai, anthropic, openai-codex); this
// rejects anything a provider id shouldn't be, before it's even quoted.
const AUTH_PROVIDER_ID_PATTERN = /^[a-z0-9_-]+$/;

function isValidAuthProviderId(provider) {
  return typeof provider === "string" && AUTH_PROVIDER_ID_PATTERN.test(provider);
}

// POSIX single-quote shell escaping: close the quote, insert an
// escaped literal quote, reopen the quote. Defense in depth for the
// `script -qfec "<command>"` transport (#291), which runs through a real
// shell — used even on values already passed through
// isValidAuthProviderId.
function shellQuoteArg(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

// The agent that owns the linked credentials. OpenClaw refuses `models auth
// login` without an explicit owner as soon as several agents are configured,
// which every Instance with Templates installed is ("Multiple agents are
// configured, but the model command has no explicit owner").
const AUTH_AGENT_ID = "main";

// Builds the exact shell command spawned via `script -qfec "<command>"
// <logfile>` for #291. All args are quoted, including static literals, so
// the command stays defensible even if a future edit adds a variable
// argument without remembering to quote it.
function buildAuthLoginShellCommand(provider) {
  return ["openclaw", "models", "auth", "login", "--provider", provider, "--force", "--agent", AUTH_AGENT_ID]
    .map(shellQuoteArg)
    .join(" ");
}

module.exports = {
  appendRecentAuthScreen,
  buildAuthLoginShellCommand,
  defaultModelForAuthProvider,
  isAuthWaitingInputMessage,
  isValidAuthProviderId,
  modelCatalogEntryForAuthProvider,
  normalizeTerminalScreenText,
  pluginIdForAuthProvider,
  resolveAuthOrderTarget,
  shellQuoteArg,
  shouldTransitionAuthSessionToWaitingInput,
  stripAnsiTerminalCodes,
};
