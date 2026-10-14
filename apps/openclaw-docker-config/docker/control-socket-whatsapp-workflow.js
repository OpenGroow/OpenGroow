const fsPromisesDefault = require("node:fs/promises");
const { join } = require("node:path");
const {
  extractWhatsAppQrDataUrl,
  UNICODE_QR_CHARS_STRING,
} = require("./control-socket-whatsapp-qr");
const { toErrorMessage: formatErrorMessage } = require("./control-socket-errors");
const { resolveOpenClawBinaryAndEnv: resolveOpenClawBinaryAndEnvShared } = require("./control-socket-openclaw");

const QR_SCAN_WINDOW_CHARS = 20_000;
// WhatsApp rotates the QR about every 20 s. Callers get the time left instead
// of guessing it, as a duration (not a date) so clocks need not agree.
const QR_LIFETIME_MS = 20_000;
const DEFAULT_PAIR_SESSION_TTL_MS = 170_000;
const DEFAULT_STATUS_TIMEOUT_MS = 30_000;
const DEFAULT_START_TIMEOUT_MS = 15_000;
const DEFAULT_WAIT_TIMEOUT_MS = 5_000;
const QR_BLOCK_RE = new RegExp(
  `(?:^[${UNICODE_QR_CHARS_STRING}]{10,}$\\n?){2,}`,
  "gm",
);

function createWhatsAppWorkflow(options = {}) {
  const fs = options.fs ?? fsPromisesDefault;
  const runCommandCapture = options.runCommandCapture;
  const spawnProcess = options.spawnProcess;
  const localPrefix = options.localPrefix ?? process.env.OPENCLAW_LOCAL_PREFIX ?? "/home/node/.local";
  const resolveOpenClawBinaryAndEnv =
    options.resolveOpenClawBinaryAndEnv ??
    (() => resolveOpenClawBinaryAndEnvShared({ localPrefix }));
  const scheduleGatewayContainerRestart =
    options.scheduleGatewayContainerRestart ?? (() => {});
  const resolveAuthDir =
    options.resolveAuthDir ??
    (() => {
      const configured = process.env.OPENCLAW_WHATSAPP_AUTH_DIR?.trim();
      if (configured) {
        return configured;
      }
      const home =
        process.env.OPENCLAW_HOME?.trim() ||
        (process.env.HOME?.trim() ? join(process.env.HOME.trim(), ".openclaw") : "/home/node/.openclaw");
      return join(home, "credentials", "whatsapp", "default");
    });
  const log = options.log ?? (() => {});
  const warn = options.warn ?? log;
  const now = options.now ?? (() => Date.now());
  const sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const setTimer = options.setTimer ?? setTimeout;
  const clearTimer = options.clearTimer ?? clearTimeout;
  const statusTimeoutMs = options.statusTimeoutMs ?? DEFAULT_STATUS_TIMEOUT_MS;
  const pairSessionTtlMs =
    options.pairSessionTtlMs ?? DEFAULT_PAIR_SESSION_TTL_MS;
  let pairSession = null;

  function sanitizePairOutput(output) {
    if (!output) {
      return "";
    }
    return String(output)
      .replace(/!\[whatsapp-qr\]\((data:image\/[^)]+)\)/gi, "[WhatsApp QR ready]")
      .replace(/(?:\x1b\[(?:47|40)m {2}\x1b\[0m)+\n?/g, "")
      .replace(/\x1b\[[0-9;]*m/g, "")
      .replace(QR_BLOCK_RE, "[WhatsApp QR ready]\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  function appendOutput(current, next) {
    const trimmedNext = typeof next === "string" ? next.trim() : "";
    if (!trimmedNext) {
      return current;
    }
    const trimmedCurrent = typeof current === "string" ? current.trim() : "";
    if (!trimmedCurrent) {
      return trimmedNext;
    }
    if (trimmedCurrent.includes(trimmedNext)) {
      return trimmedCurrent;
    }
    return `${trimmedCurrent}\n${trimmedNext}`;
  }

  function inferConnected(output) {
    const normalized = String(output || "").toLowerCase();
    if (!normalized) {
      return false;
    }
    if (normalized.includes("not connected") || normalized.includes("disconnected")) {
      return false;
    }
    return normalized.includes("connected");
  }

  function shouldResetAuthState(message) {
    const normalized = String(message || "").toLowerCase();
    return (
      normalized.includes("device_removed") ||
      normalized.includes('"tag":"conflict"') ||
      normalized.includes("stream errored") ||
      normalized.includes("logged out") ||
      normalized.includes("unauthorized")
    );
  }

  function isActive(session) {
    if (!session || session.done === true || session.error) {
      return false;
    }
    if (isQrExpired(session.startOutput) || isQrExpired(session.waitOutput)) {
      return false;
    }
    const issuedAtMs =
      typeof session.qrIssuedAtMs === "number"
        ? session.qrIssuedAtMs
        : typeof session.createdAtMs === "number"
          ? session.createdAtMs
          : 0;
    return issuedAtMs > 0 ? now() - issuedAtMs < pairSessionTtlMs : true;
  }

  function qrExpiresInMs(session) {
    if (!session?.qrDataUrl || typeof session.qrIssuedAtMs !== "number") {
      return undefined;
    }
    return Math.max(0, session.qrIssuedAtMs + QR_LIFETIME_MS - now());
  }

  function isQrExpired(output) {
    const normalized = String(output || "").toLowerCase();
    return (
      normalized.includes("status=408") ||
      normalized.includes("request time-out qr refs attempts ended") ||
      normalized.includes("login qr expired") ||
      normalized.includes("generate a new qr")
    );
  }

  function readTimeoutMs(value, fallbackMs) {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return fallbackMs;
    }
    return Math.max(1000, Math.floor(value));
  }

  function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => {
      resolve = res;
      reject = rej;
    });
    promise.catch(() => {});
    return { promise, resolve, reject };
  }

  async function waitFor(promise, timeoutMs, message) {
    return Promise.race([
      promise,
      new Promise((_, reject) => {
        setTimer(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  }

  async function clearAuthState() {
    const authDir = resolveAuthDir();
    try {
      await fs.rm(authDir, { recursive: true, force: true });
      log(`whatsapp auth state cleared: ${authDir}`);
    } catch (error) {
      warn(`failed to clear whatsapp auth state at ${authDir}: ${formatErrorMessage(error)}`);
    }
  }

  async function logout() {
    try {
      const result = await runCommandCapture(
        "openclaw",
        ["channels", "logout", "--channel", "whatsapp", "--account", "default"],
        20_000,
      );
      const output = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
      if (output) {
        log(`whatsapp logout: ${output}`);
      }
    } catch (error) {
      const message = formatErrorMessage(error);
      if (/unsupported channel:\s*whatsapp/i.test(message)) {
        log("whatsapp logout unsupported in this OpenClaw build; clearing auth state directly");
      } else {
        warn(`whatsapp logout failed: ${message}`);
      }
    } finally {
      await clearAuthState();
      pairSession = null;
    }
  }

  async function probe(timeoutMs) {
    const result = await runCommandCapture(
      "openclaw",
      [
        "channels",
        "status",
        "--probe",
        "--json",
        "--timeout",
        String(Math.max(1000, timeoutMs)),
      ],
      Math.max(statusTimeoutMs, timeoutMs + 5000),
    );
    let payload;
    try {
      payload = JSON.parse(result.stdout);
    } catch {
      return {
        linked: false,
        connected: inferConnected(result.stdout),
        output: sanitizePairOutput(result.stdout || result.stderr || "Unable to parse WhatsApp status"),
      };
    }
    const accounts = payload?.channelAccounts?.whatsapp;
    const firstAccount = Array.isArray(accounts) && accounts[0] && typeof accounts[0] === "object"
      ? accounts[0]
      : undefined;
    if (!firstAccount) {
      return {
        linked: false,
        connected: false,
        resetAuthState: false,
        output: "WhatsApp channel not configured.",
      };
    }
    const lastError = typeof firstAccount.lastError === "string" ? firstAccount.lastError.trim() : "";
    const resetAuthState = shouldResetAuthState(lastError);
    const linked = !resetAuthState && firstAccount.linked === true;
    const connected = !resetAuthState && firstAccount.connected === true;
    const bits = [];
    if (typeof firstAccount.accountId === "string" && firstAccount.accountId.trim()) {
      bits.push(`account:${firstAccount.accountId.trim()}`);
    }
    bits.push(linked ? "linked" : "not linked");
    if (typeof firstAccount.connected === "boolean") {
      bits.push(firstAccount.connected ? "connected" : "disconnected");
    }
    if (firstAccount.probe && typeof firstAccount.probe === "object" && firstAccount.probe.ok === false) {
      bits.push("probe failed");
    }
    if (lastError) {
      bits.push(`error:${lastError}`);
    }
    if (resetAuthState) {
      bits.push("saved session rejected");
    }
    return {
      linked,
      connected,
      running: firstAccount.running === true,
      resetAuthState,
      output: bits.join(", "),
    };
  }

  async function finalize(session, timeoutMs) {
    let status = null;
    try {
      status = await probe(timeoutMs);
    } catch (error) {
      warn(`whatsapp status probe after link failed: ${formatErrorMessage(error)}`);
    }
    if (status) {
      session.linked = status.linked;
      session.connected = status.connected;
      session.waitOutput = appendOutput(session.waitOutput, status.output);
      if (status.resetAuthState) {
        session.waitOutput = appendOutput(
          session.waitOutput,
          "WhatsApp rejected the saved session; generate a new QR code and scan it again.",
        );
      }
    }
  }

  async function startSession(force, startTimeoutMs) {
    if (force) {
      await logout();
      await sleep(3000);
      await clearAuthState();
    }
    if (pairSession && isActive(pairSession)) {
      return pairSession;
    }
    pairSession = null;
    const session = {
      id: `${now()}`,
      createdAtMs: now(),
      startReady: deferred(),
      completion: deferred(),
      connected: false,
      linked: false,
      done: false,
      qrDataUrl: undefined,
      qrIssuedAtMs: undefined,
      startOutput: undefined,
      waitOutput: undefined,
      error: undefined,
      child: null,
    };
    pairSession = session;
    const waitTimeoutMs = Math.max(180_000, startTimeoutMs * 12);
    void (async () => {
      try {
        await new Promise((resolve, reject) => {
          const { binary, env } = resolveOpenClawBinaryAndEnv();
          const child = spawnProcess(binary, ["channels", "login", "--channel", "whatsapp"], {
            env,
            stdio: ["ignore", "pipe", "pipe"],
          });
          session.child = child;
          let output = "";
          let startResolved = false;
          const startTimer = setTimer(() => {
            if (!startResolved) {
              child.kill("SIGTERM");
              reject(new Error("Timed out waiting for WhatsApp QR code"));
            }
          }, startTimeoutMs + 2000);
          const waitTimer = setTimer(() => {
            child.kill("SIGTERM");
            if (startResolved) {
              resolve();
            }
          }, waitTimeoutMs);
          const onData = (chunk) => {
            output += chunk.toString("utf8");
            const scanWindow = output.length > QR_SCAN_WINDOW_CHARS
              ? output.slice(-QR_SCAN_WINDOW_CHARS)
              : output;
            if (!startResolved) {
              const qrDataUrl = extractWhatsAppQrDataUrl(scanWindow);
              if (qrDataUrl) {
                startResolved = true;
                clearTimer(startTimer);
                session.qrDataUrl = qrDataUrl;
                session.qrIssuedAtMs = now();
                session.startOutput = sanitizePairOutput(output) || "WhatsApp QR ready.";
                session.startReady.resolve();
              } else if (/linked!|credentials saved/i.test(scanWindow)) {
                startResolved = true;
                clearTimer(startTimer);
                session.linked = true;
                session.startOutput = sanitizePairOutput(output) || "WhatsApp already linked. Restarting gateway…";
                session.startReady.resolve();
                log("whatsapp credentials already saved — scheduling gateway restart to activate channel");
                scheduleGatewayContainerRestart();
              }
              return;
            }
            if (session.linked || session.connected) {
              return;
            }
            const refreshedQrDataUrl = extractWhatsAppQrDataUrl(scanWindow);
            if (refreshedQrDataUrl && refreshedQrDataUrl !== session.qrDataUrl) {
              session.qrDataUrl = refreshedQrDataUrl;
              session.qrIssuedAtMs = now();
              session.startOutput = sanitizePairOutput(output) || session.startOutput;
            }
          };
          child.stdout.on("data", onData);
          child.stderr.on("data", onData);
          child.on("error", (error) => {
            clearTimer(startTimer);
            clearTimer(waitTimer);
            reject(error);
          });
          child.on("close", (code) => {
            clearTimer(startTimer);
            clearTimer(waitTimer);
            session.child = null;
            const sanitized = sanitizePairOutput(output);
            session.waitOutput = sanitized || "WhatsApp login completed.";
            if (!startResolved) {
              if (code === 0 && /linked!|credentials saved/i.test(output)) {
                startResolved = true;
                session.linked = true;
                session.startOutput = sanitized || "WhatsApp already linked.";
                session.startReady.resolve();
                resolve();
              } else {
                const detail = sanitized ? `: ${sanitized}` : "";
                reject(new Error(`openclaw channels login exited before QR was generated (exit code ${code ?? "unknown"})${detail}`));
              }
            } else {
              resolve();
            }
          });
        });
        await finalize(session, statusTimeoutMs);
        session.done = true;
        session.completion.resolve();
      } catch (error) {
        const message = formatErrorMessage(error);
        session.child = null;
        session.error = message;
        session.done = true;
        session.startReady.reject(new Error(message));
        session.completion.reject(new Error(message));
      }
    })();
    return session;
  }

  async function pairStart(body = {}) {
    const timeoutMs = readTimeoutMs(body.timeoutMs, DEFAULT_START_TIMEOUT_MS);
    const session = await startSession(body.force === true, timeoutMs);
    if (!session.qrDataUrl && !session.connected && !session.error) {
      await waitFor(session.startReady.promise, timeoutMs + 2000, "Timed out waiting for WhatsApp QR");
    }
    if (session.error) {
      throw new Error(session.error);
    }
    return {
      status: 200,
      body: {
        ok: true,
        data: {
          output: session.startOutput ?? session.waitOutput ?? "Waiting for WhatsApp QR...",
          linked: session.linked,
          connected: session.connected,
          qrDataUrl: session.qrDataUrl,
          qrExpiresInMs: qrExpiresInMs(session),
        },
      },
    };
  }

  async function pairWait(body = {}) {
    const timeoutMs = readTimeoutMs(body.timeoutMs, DEFAULT_WAIT_TIMEOUT_MS);
    const session = pairSession;
    if (session && !session.done && !session.connected && !session.error) {
      try {
        await waitFor(session.completion.promise, timeoutMs, "Timed out waiting for WhatsApp login completion");
      } catch {
        // Fall through to a live probe while pairing continues.
      }
    }
    if (pairSession?.error) {
      throw new Error(pairSession.error);
    }
    if (pairSession?.done) {
      await sleep(1500);
    }
    let status = await probe(timeoutMs);
    if (status.resetAuthState) {
      await clearAuthState();
      pairSession = null;
      return {
        status: 200,
        body: {
          ok: false,
          error: "WhatsApp rejected the saved session; cleared saved credentials. Generate a new QR code and scan it again.",
          data: {
            output: appendOutput(status.output, "WhatsApp rejected the saved session; cleared saved credentials. Generate a new QR code and scan it again."),
            linked: false,
            connected: false,
          },
        },
      };
    }
    if (status.linked && !status.connected && session) {
      session.linked = status.linked;
      session.connected = status.connected;
      session.waitOutput = appendOutput(session.waitOutput, status.output);
      await finalize(session, timeoutMs);
      status = {
        ...status,
        linked: session.linked,
        connected: session.connected,
        output: session.waitOutput || status.output,
      };
    }
    return {
      status: 200,
      body: {
        ok: true,
        data: {
          output: status.output || pairSession?.waitOutput || pairSession?.startOutput || "WhatsApp status checked.",
          linked: status.linked,
          connected: status.connected,
          qrDataUrl: status.connected || status.linked ? undefined : pairSession?.qrDataUrl,
          qrExpiresInMs: status.connected || status.linked ? undefined : qrExpiresInMs(pairSession),
        },
      },
    };
  }

  async function close() {
    if (pairSession?.child) {
      pairSession.child.kill("SIGTERM");
    }
    pairSession = null;
  }

  return { close, logout, pairStart, pairWait };
}

module.exports = { createWhatsAppWorkflow };
