const fsPromisesDefault = require("node:fs/promises");
const { randomUUID } = require("node:crypto");
const { spawn: spawnDefault } = require("node:child_process");
const { dirname } = require("node:path");
const {
  appendRecentAuthScreen,
  buildAuthLoginShellCommand,
  defaultModelForAuthProvider,
  isValidAuthProviderId,
  modelCatalogEntryForAuthProvider,
  pluginIdForAuthProvider,
  resolveAuthOrderTarget,
  shouldTransitionAuthSessionToWaitingInput,
} = require("./control-socket-auth");

const DEFAULT_AUTH_SESSION_TTL_MS = 60 * 60 * 1000;
const DEFAULT_AUTH_LOG_MAX_LINES = 300;
const DEFAULT_AUTH_PROMPT_TIMEOUT_MS = 90 * 1000;
const DEFAULT_AUTH_VERIFY_TIMEOUT_MS = 180 * 1000;
const DEFAULT_AUTH_RESTART_RECOVERY_ERROR =
  "Gateway restarted during authorization flow. Start the flow again.";
const DEFAULT_AUTH_REDIRECT_URL_PREFIX = "http://localhost:1455/";
const DEFAULT_CONFIG_TIMEOUT_MS = 60 * 1000;
const CONFIG_CONFLICT_ATTEMPTS = 4;
const CONFIG_CONFLICT_RETRY_DELAY_MS = 1000;

function ok(data) {
  return { status: 200, body: { ok: true, data } };
}

function failure(status, error, data) {
  return { status, body: { ok: false, error, ...(data ? { data } : {}) } };
}

function toErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function extractUrls(output) {
  if (!output) {
    return [];
  }
  const matches = String(output).match(/https?:\/\/[^\s]+/g) ?? [];
  return Array.from(new Set(matches));
}

function normalizeAuthLogLine(line) {
  const cleaned = String(line || "")
    .replace(/\u001b\[[0-9;]*[A-Za-z]/g, "")
    .replace(/\r/g, "")
    .trim();
  return cleaned || null;
}

// `openclaw config set` has no dedicated exit code for this (only
// `--dry-run --json` reports a structured "conflict"), so match the sentence
// its CLI prints: the wrapper first, the detail inside it as a fallback.
function isConfigConflict(error) {
  return /config file changed while this command was writing|config changed since last load/i.test(
    toErrorMessage(error),
  );
}

function createAuthWorkflow(options = {}) {
  const fsPromises = options.fs ?? fsPromisesDefault;
  const spawnProcess = options.spawnProcess ?? spawnDefault;
  const sessionStore = options.sessionStore ?? new Map();
  const now = options.now ?? (() => Date.now());
  const setTimer = options.setTimer ?? setTimeout;
  const clearTimer = options.clearTimer ?? clearTimeout;
  const sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const runCommandCapture = options.runCommandCapture;
  const log = options.log ?? (() => {});
  const warn = options.warn ?? log;
  const authSessionsPath = options.authSessionsPath ?? null;
  const authSessionTtlMs =
    options.authSessionTtlMs ?? DEFAULT_AUTH_SESSION_TTL_MS;
  const authLogMaxLines = options.authLogMaxLines ?? DEFAULT_AUTH_LOG_MAX_LINES;
  const authPromptTimeoutMs =
    options.authPromptTimeoutMs ?? DEFAULT_AUTH_PROMPT_TIMEOUT_MS;
  const authVerifyTimeoutMs =
    options.authVerifyTimeoutMs ?? DEFAULT_AUTH_VERIFY_TIMEOUT_MS;
  const authRestartRecoveryError =
    options.authRestartRecoveryError ?? DEFAULT_AUTH_RESTART_RECOVERY_ERROR;
  const authRedirectUrlPrefix =
    options.authRedirectUrlPrefix ?? DEFAULT_AUTH_REDIRECT_URL_PREFIX;
  const configTimeoutMs = options.configTimeoutMs ?? DEFAULT_CONFIG_TIMEOUT_MS;
  const logFilePathForSession =
    options.logFilePathForSession ?? ((session) => `/tmp/openclaw-auth-${session.id}.log`);
  let saveChain = Promise.resolve();

  // OpenClaw refuses a write when the file changed since it read it, and
  // changes nothing. The Gateway rewrites openclaw.json itself right after a
  // hot reload (switching to OpenAI also touches plugins.entries.openai), so
  // any write here can lose that race: re-running it picks up the new file.
  async function command(command, args, timeoutMs = configTimeoutMs) {
    if (!runCommandCapture) {
      throw new Error("Auth workflow command runner is not configured");
    }
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await runCommandCapture(command, args, timeoutMs);
      } catch (error) {
        if (attempt >= CONFIG_CONFLICT_ATTEMPTS || !isConfigConflict(error)) throw error;
        warn(`openclaw ${args.slice(0, 2).join(" ")}: config changed under the write, retrying (${attempt}/${CONFIG_CONFLICT_ATTEMPTS - 1})`);
        await sleep(CONFIG_CONFLICT_RETRY_DELAY_MS);
      }
    }
  }

  function touch(session) {
    session.updatedAtMs = now();
  }

  function createSession(provider) {
    const timestamp = now();
    return {
      id: randomUUID(),
      provider,
      status: "queued",
      logs: [],
      authUrl: undefined,
      createdAtMs: timestamp,
      updatedAtMs: timestamp,
      outputBuffer: "",
      error: undefined,
      authInputSubmitted: false,
      lastSubmittedAuthInput: "",
      authInputSubmittedAtMs: 0,
      recentScreenBuffer: "",
      child: null,
      logFilePath: null,
      promptTimer: null,
      verifyTimer: null,
      terminationReason: null,
      awaitingResume: false,
      primaryModelActivated: false,
    };
  }

  function updateState(session, status, error, reason) {
    const previousStatus = session.status;
    const previousError = session.error;
    session.status = status;
    session.error = error;
    touch(session);
    if (previousStatus !== status || previousError !== error) {
      log(
        `auth session ${session.id} state ${previousStatus} -> ${status}${
          reason ? ` (${reason})` : ""
        }${error ? ` error=${error}` : ""}`,
      );
    }
    void scheduleSave();
  }

  function serializeSession(session) {
    return {
      sessionId: session.id,
      provider: session.provider,
      status: session.status,
      logs: Array.isArray(session.logs) ? [...session.logs] : [],
      authUrl: session.authUrl,
      error: session.error,
      createdAtMs: session.createdAtMs,
      updatedAtMs: session.updatedAtMs,
      terminationReason: session.terminationReason,
      awaitingResume: session.awaitingResume === true,
      primaryModelActivated: session.primaryModelActivated === true,
    };
  }

  function hydrateSession(record) {
    const sessionId =
      typeof record?.sessionId === "string" ? record.sessionId.trim() : "";
    const provider =
      typeof record?.provider === "string" ? record.provider.trim() : "";
    if (!sessionId || !provider) {
      return null;
    }
    const timestamp = now();
    return {
      id: sessionId,
      provider,
      status: typeof record.status === "string" ? record.status : "failed",
      logs: Array.isArray(record.logs)
        ? record.logs.map(normalizeAuthLogLine).filter(Boolean)
        : [],
      authUrl: typeof record.authUrl === "string" ? record.authUrl : undefined,
      createdAtMs:
        typeof record.createdAtMs === "number" && Number.isFinite(record.createdAtMs)
          ? record.createdAtMs
          : timestamp,
      updatedAtMs:
        typeof record.updatedAtMs === "number" && Number.isFinite(record.updatedAtMs)
          ? record.updatedAtMs
          : timestamp,
      outputBuffer: "",
      error: typeof record.error === "string" ? record.error : undefined,
      authInputSubmitted: false,
      lastSubmittedAuthInput: "",
      authInputSubmittedAtMs: 0,
      recentScreenBuffer: "",
      child: null,
      logFilePath: null,
      promptTimer: null,
      verifyTimer: null,
      terminationReason:
        typeof record.terminationReason === "string"
          ? record.terminationReason
          : null,
      awaitingResume: record.awaitingResume === true,
      primaryModelActivated: record.primaryModelActivated === true,
    };
  }

  async function saveSessions() {
    if (!authSessionsPath) {
      return;
    }
    const records = Array.from(sessionStore.values()).map(serializeSession);
    await fsPromises.mkdir(dirname(authSessionsPath), { recursive: true });
    const tempPath = `${authSessionsPath}.${process.pid}.tmp`;
    await fsPromises.writeFile(
      tempPath,
      JSON.stringify({ savedAtMs: now(), sessions: records }, null, 2),
      "utf8",
    );
    await fsPromises.rename(tempPath, authSessionsPath);
  }

  function scheduleSave() {
    saveChain = saveChain
      .catch(() => {})
      .then(() => saveSessions())
      .catch((error) => {
        warn(`failed to persist auth sessions: ${toErrorMessage(error)}`);
      });
    return saveChain;
  }

  function clearPromptTimer(session) {
    if (session.promptTimer) {
      clearTimer(session.promptTimer);
      session.promptTimer = null;
    }
  }

  function clearVerifyTimer(session) {
    if (session.verifyTimer) {
      clearTimer(session.verifyTimer);
      session.verifyTimer = null;
    }
  }

  function pushLogLine(session, rawLine) {
    const line = normalizeAuthLogLine(rawLine);
    if (!line) {
      return;
    }
    session.logs.push(line);
    if (session.logs.length > authLogMaxLines) {
      session.logs.splice(0, session.logs.length - authLogMaxLines);
    }
    const authUrl = extractUrls(line)[0];
    if (authUrl) {
      session.authUrl = authUrl;
    }
    if (
      shouldTransitionAuthSessionToWaitingInput({
        output: line,
        authInputSubmittedAtMs: session.authInputSubmittedAtMs,
        now: now(),
      })
    ) {
      updateState(session, "waiting_input", undefined, "waiting for redirect input");
      session.awaitingResume = false;
      clearPromptTimer(session);
      clearVerifyTimer(session);
    }
  }

  function flushOutputBuffer(session) {
    if (session.outputBuffer) {
      pushLogLine(session, session.outputBuffer);
      session.outputBuffer = "";
    }
  }

  function startVerifyTimer(session) {
    clearVerifyTimer(session);
    session.verifyTimer = setTimer(() => {
      warn(`auth verify timeout for session ${session.id}`);
      terminateSession(
        session,
        "failed",
        "Authorization verification timed out after the redirect URL was submitted.",
      );
    }, authVerifyTimeoutMs);
  }

  function processOutputChunk(session, text) {
    const chunk = String(text || "");
    if (!chunk) {
      return;
    }
    session.recentScreenBuffer = appendRecentAuthScreen(
      session.recentScreenBuffer,
      chunk,
    );
    if (
      session.authInputSubmitted &&
      session.status === "running" &&
      !session.recentScreenBuffer.includes("Paste the redirect URL") &&
      !session.recentScreenBuffer.includes("OAuth URL ready")
    ) {
      startVerifyTimer(session);
    }
    const normalizedChunk = `${session.outputBuffer}${chunk
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n")}`;
    const lines = normalizedChunk.split("\n");
    session.outputBuffer = lines.pop() ?? "";
    for (const line of lines) {
      pushLogLine(session, line);
    }
  }

  function startPromptTimer(session) {
    clearPromptTimer(session);
    session.promptTimer = setTimer(() => {
      warn(`auth prompt timeout for session ${session.id}`);
      terminateSession(
        session,
        "failed",
        "Authorization URL generation timed out. Start the flow again.",
      );
    }, authPromptTimeoutMs);
  }

  function terminateSession(session, status, error) {
    clearPromptTimer(session);
    clearVerifyTimer(session);
    session.terminationReason = status;
    session.awaitingResume = false;
    updateState(session, status, error, "terminated");
    pushLogLine(session, `[auth] ${error}`);
    if (session.child) {
      session.child.kill("SIGTERM");
    }
  }

  function terminateActiveSessions(reason) {
    for (const session of sessionStore.values()) {
      if (session.child) {
        terminateSession(session, "cancelled", reason);
      }
    }
  }

  function pruneSessions() {
    const timestamp = now();
    let changed = false;
    for (const [sessionId, session] of sessionStore.entries()) {
      if (!session.child && timestamp - session.updatedAtMs > authSessionTtlMs) {
        sessionStore.delete(sessionId);
        changed = true;
      }
    }
    if (changed) {
      void scheduleSave();
    }
  }

  function findSession(sessionId) {
    pruneSessions();
    const trimmed = typeof sessionId === "string" ? sessionId.trim() : "";
    return trimmed ? sessionStore.get(trimmed) ?? null : null;
  }

  function snapshot(session) {
    flushOutputBuffer(session);
    return {
      sessionId: session.id,
      provider: session.provider,
      model:
        session.status === "succeeded" && session.primaryModelActivated
          ? defaultModelForAuthProvider(session.provider)
          : undefined,
      status: session.status,
      logs: [...session.logs],
      authUrl: session.authUrl,
      error: session.error,
      awaitingResume: session.awaitingResume === true,
    };
  }

  async function setAgentsDefaultModelPrimary(model) {
    await command(
      "openclaw",
      [
        "config",
        "set",
        "--json",
        "agents.defaults.model",
        JSON.stringify({ primary: model }),
      ],
    );
  }

  async function ensureAuthProviderPluginEnabled(provider) {
    const pluginId = pluginIdForAuthProvider(provider);
    if (!pluginId) {
      return;
    }
    let allowList = [];
    try {
      const { stdout } = await command(
        "openclaw",
        ["config", "get", "plugins.allow", "--json"],
      );
      const parsed = JSON.parse(stdout || "[]");
      if (Array.isArray(parsed)) {
        allowList = parsed;
      }
    } catch {
      // plugins.allow may not exist yet.
    }
    try {
      if (!allowList.includes(pluginId)) {
        await command(
          "openclaw",
          ["config", "set", "--json", "plugins.allow", JSON.stringify([...allowList, pluginId])],
        );
      }
      await command("openclaw", ["plugins", "enable", pluginId]);
      log(`auth session succeeded for provider=${provider}; ensured plugin=${pluginId}`);
    } catch (error) {
      warn(`failed to enable plugin=${pluginId} after provider=${provider} auth: ${toErrorMessage(error)}`);
    }
  }

  async function ensureAuthProviderModelRegistered(provider) {
    const entry = modelCatalogEntryForAuthProvider(provider);
    if (!entry) {
      return;
    }
    const modelsPath = `models.providers.${provider}.models`;
    try {
      const { stdout } = await command(
        "openclaw",
        ["config", "get", modelsPath, "--json"],
      );
      const parsed = JSON.parse(stdout || "[]");
      if (Array.isArray(parsed) && parsed.some((existing) => existing?.id === entry.id)) {
        return;
      }
    } catch {
      // The path may not exist yet.
    }
    try {
      await command(
        "openclaw",
        ["config", "set", "--json", modelsPath, JSON.stringify([entry])],
      );
      log(`auth session succeeded for provider=${provider}; registered ${modelsPath}=${entry.id}`);
    } catch (error) {
      warn(`failed to register model catalog entry for provider=${provider}: ${toErrorMessage(error)}`);
    }
  }

  async function applyAuthProviderPrimaryModel(provider) {
    await ensureAuthProviderPluginEnabled(provider);
    await ensureAuthProviderModelRegistered(provider);
    const model = defaultModelForAuthProvider(provider);
    if (!model) {
      return false;
    }
    try {
      await setAgentsDefaultModelPrimary(model);
      log(`auth session succeeded for provider=${provider}; set agents.defaults.model.primary=${model}`);
      return true;
    } catch (error) {
      warn(`failed to set agents.defaults.model.primary after provider=${provider} auth: ${toErrorMessage(error)}`);
      return false;
    }
  }

  async function cleanupAuthLogFile(session) {
    const logFilePath = session.logFilePath;
    if (!logFilePath) {
      return;
    }
    session.logFilePath = null;
    try {
      await fsPromises.unlink(logFilePath);
    } catch (error) {
      if (error?.code !== "ENOENT") {
        warn(`failed to remove auth log file ${logFilePath}: ${toErrorMessage(error)}`);
      }
    }
  }

  async function startInteractiveSession(provider) {
    if (!isValidAuthProviderId(provider)) {
      throw new Error(`Invalid provider id "${provider}"`);
    }
    terminateActiveSessions("Previous authorization flow cancelled in favor of a new one.");
    const session = createSession(provider);
    updateState(session, "running", undefined, "interactive auth started");
    sessionStore.set(session.id, session);
    void scheduleSave();
    startPromptTimer(session);
    session.logFilePath = logFilePathForSession(session);
    await fsPromises.writeFile(session.logFilePath, "");
    const child = spawnProcess(
      "script",
      ["-qfec", buildAuthLoginShellCommand(provider), session.logFilePath],
      { env: process.env, stdio: ["pipe", "pipe", "pipe"] },
    );
    session.child = child;
    child.stdout.on("data", (chunk) => processOutputChunk(session, chunk.toString("utf8")));
    child.stderr.on("data", (chunk) => processOutputChunk(session, chunk.toString("utf8")));
    child.on("error", (error) => {
      clearPromptTimer(session);
      clearVerifyTimer(session);
      session.child = null;
      session.awaitingResume = false;
      updateState(session, "failed", toErrorMessage(error), "child process error");
      pushLogLine(session, toErrorMessage(error));
      void cleanupAuthLogFile(session);
    });
    child.on("close", async (code, signal) => {
      clearPromptTimer(session);
      clearVerifyTimer(session);
      session.child = null;
      flushOutputBuffer(session);
      if (session.terminationReason === "cancelled") {
        updateState(session, "cancelled", session.error, "child closed after cancel");
      } else if (session.terminationReason === "failed") {
        updateState(session, "failed", session.error, "child closed after failure");
      } else if (typeof code === "number" && code === 0) {
        session.awaitingResume = false;
        session.primaryModelActivated = await applyAuthProviderPrimaryModel(provider);
        updateState(session, "succeeded", undefined, "auth completed");
        pushLogLine(session, `[auth] completed ${provider}`);
      } else {
        session.awaitingResume = false;
        const nextError =
          session.error ||
          `Auth command failed with exit code ${typeof code === "number" ? code : "unknown"}${
            signal ? ` (${signal})` : ""
          }`;
        updateState(session, "failed", nextError, "child closed with error");
        pushLogLine(session, nextError);
      }
      log(`auth session ${session.id} child closed code=${typeof code === "number" ? code : "unknown"} signal=${signal ?? "none"}`);
      void cleanupAuthLogFile(session);
    });
    return session;
  }

  async function load() {
    if (!authSessionsPath) {
      return;
    }
    try {
      const raw = await fsPromises.readFile(authSessionsPath, "utf8");
      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch (error) {
        warn(`failed to parse persisted auth sessions: ${toErrorMessage(error)}`);
        return;
      }
      let restoredCount = 0;
      let recoveredCount = 0;
      for (const record of Array.isArray(parsed?.sessions) ? parsed.sessions : []) {
        const session = hydrateSession(record);
        if (!session) {
          continue;
        }
        if (["queued", "running", "waiting_input"].includes(session.status)) {
          clearPromptTimer(session);
          clearVerifyTimer(session);
          session.awaitingResume = true;
          session.terminationReason = "restart_recovered";
          updateState(session, "failed", authRestartRecoveryError, "restart recovered");
          pushLogLine(session, `[auth] ${authRestartRecoveryError}`);
          recoveredCount += 1;
        }
        sessionStore.set(session.id, session);
        restoredCount += 1;
      }
      pruneSessions();
      await saveSessions();
      log(`loaded ${restoredCount} auth sessions${recoveredCount > 0 ? ` (${recoveredCount} recovered after restart)` : ""}`);
    } catch (error) {
      if (error?.code === "ENOENT") {
        log("no persisted auth sessions found");
        return;
      }
      throw error;
    }
  }

  function sessionNotFound() {
    return failure(404, "Auth session not found");
  }

  async function start(body = {}) {
    const provider = typeof body.provider === "string" ? body.provider.trim() : "openai";
    if (!provider) {
      throw new Error("provider is required");
    }
    const session = await startInteractiveSession(provider);
    return ok(snapshot(session));
  }

  async function status(body = {}) {
    const session = findSession(body.sessionId);
    return session ? ok(snapshot(session)) : sessionNotFound();
  }

  async function input(body = {}) {
    const session = findSession(body.sessionId);
    if (!session) {
      return sessionNotFound();
    }
    if (session.awaitingResume) {
      return failure(409, authRestartRecoveryError, snapshot(session));
    }
    if (!session.child?.stdin) {
      return failure(400, session.status === "failed" ? "Auth session failed" : "Auth session is not active");
    }
    const rawInput = typeof body.input === "string" ? body.input : "";
    const enter = body.enter === true;
    const trimmedInput = rawInput.trim();
    if (!enter && trimmedInput && !trimmedInput.startsWith(authRedirectUrlPrefix)) {
      return failure(400, `Redirect URL must start with ${authRedirectUrlPrefix}`);
    }
    let payload = rawInput;
    if (enter || payload.trim().length === 0) {
      payload = "\r\n";
    } else if (!payload.endsWith("\n") && !payload.endsWith("\r")) {
      payload += "\r\n";
    }
    session.child.stdin.write(payload);
    session.outputBuffer = "";
    session.recentScreenBuffer = "";
    updateState(session, "running", undefined, "redirect input submitted");
    session.awaitingResume = false;
    session.authInputSubmitted = true;
    session.lastSubmittedAuthInput = enter ? "" : rawInput.trim();
    session.authInputSubmittedAtMs = now();
    session.terminationReason = null;
    startVerifyTimer(session);
    pushLogLine(session, enter || !rawInput.trim() ? "[auth] received ENTER" : "[auth] received input");
    return ok(snapshot(session));
  }

  async function cancel(body = {}) {
    const session = findSession(body.sessionId);
    if (!session) {
      return sessionNotFound();
    }
    terminateSession(session, "cancelled", "Authorization flow cancelled.");
    return ok(snapshot(session));
  }

  async function activate(body = {}) {
    const provider = typeof body.provider === "string" ? body.provider.trim() : "";
    if (!provider) {
      return failure(400, "provider is required");
    }
    const explicitModel = typeof body.model === "string" ? body.model.trim() : "";
    const model = explicitModel || defaultModelForAuthProvider(provider);
    if (!model) {
      return failure(400, `No default model known for provider "${provider}". Link it via the OAuth flow first.`);
    }
    let profiles;
    try {
      profiles = await listAuthProfilesForProvider(provider);
    } catch (error) {
      return failure(500, `Failed to check saved credentials for provider "${provider}": ${toErrorMessage(error)}`);
    }
    if (profiles.length === 0) {
      return failure(400, `No linked credential found for provider "${provider}". Link it via the OAuth flow first.`);
    }
    try {
      await setAgentsDefaultModelPrimary(model);
    } catch (error) {
      return failure(500, `Failed to reactivate provider "${provider}": ${toErrorMessage(error)}`);
    }
    log(`auth activate: set agents.defaults.model.primary=${model} for provider=${provider}`);
    return ok({ provider, model });
  }

  async function listAuthProfilesForProvider(provider) {
    const { stdout } = await command(
      "openclaw",
      ["models", "auth", "list", "--provider", provider, "--json"],
    );
    const parsed = JSON.parse(stdout || "{}");
    return Array.isArray(parsed.profiles) ? parsed.profiles : [];
  }

  async function orderActivate(body = {}) {
    const provider = typeof body.provider === "string" ? body.provider.trim() : "";
    const kind = typeof body.kind === "string" ? body.kind.trim() : "";
    const model = typeof body.model === "string" ? body.model.trim() : "";
    if (!provider || !model) {
      return failure(400, "provider and model are required");
    }
    if (kind !== "apikey" && kind !== "subscription") {
      return failure(400, 'kind must be "apikey" or "subscription"');
    }
    let profiles;
    try {
      profiles = await listAuthProfilesForProvider(provider);
    } catch (error) {
      return failure(500, `Failed to list auth profiles for provider "${provider}": ${toErrorMessage(error)}`);
    }
    const target = resolveAuthOrderTarget(profiles, kind);
    if (!target) {
      return failure(400, `No saved ${kind === "apikey" ? "API-key" : "OAuth subscription"} credential found for provider "${provider}". Link or configure it first.`);
    }
    try {
      await command("openclaw", ["models", "auth", "order", "set", "--provider", provider, ...target.order]);
      await setAgentsDefaultModelPrimary(model);
    } catch (error) {
      return failure(500, `Failed to switch provider "${provider}" to its ${kind} credential: ${toErrorMessage(error)}`);
    }
    log(`auth order activate: provider=${provider} kind=${kind} profileId=${target.profileId} model=${model}`);
    return ok({ provider, kind, model, profileId: target.profileId });
  }

  async function close(reason = "Authorization flow cancelled during shutdown.") {
    terminateActiveSessions(reason);
    await saveChain;
  }

  return {
    activate,
    cancel,
    close,
    input,
    load,
    orderActivate,
    start,
    status,
  };
}

module.exports = {
  createAuthWorkflow,
};
