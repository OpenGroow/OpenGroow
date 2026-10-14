import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadOpenClawConnectEnvFile } from "./env.js";
import {
  type AttemptHandle,
  createLocalRelayServer,
  startAttempt,
} from "./node-run-attempt.js";
import {
  cleanupLocalOpenClawRelayProcesses,
  ensureLocalNodeConfig,
  pruneStaleIdentities,
  resolveOpenClawStateDir,
  resolveOpenClawBin,
  rotateInvalidLocalNodeIdentity,
} from "./node-run-openclaw.js";
import {
  buildDeviceSignatureRotationExhaustedMessage,
  buildFatalOutcomeMessage,
  decideSupervisorAction,
  hasExhaustedDeviceSignatureRotations,
  isConnectTicketExpiredOutcome,
  isInvalidDeviceSignatureOutcome,
} from "./node-run-supervisor.js";
import { sleep } from "./ws-utils.js";

loadOpenClawConnectEnvFile();

const DEFAULT_PAIRING_WAIT_MS = 120_000;
const DEFAULT_PAIRING_RETRY_MS = 3_000;

const DEFAULT_RECONNECT_DELAY_MS = 3_000;

type ParsedArgs = {
  relayUrl: string;
  stateKey: string;
  listenHost: string;
  listenPort: number;
  openclawBin: string;
  pairingWaitMs: number;
  pairingRetryMs: number;
  reconnect: boolean;
  reconnectDelayMs: number;
  forwardedArgs: string[];
};

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  const relayUrl = new URL(args.relayUrl);
  if (!["ws:", "wss:"].includes(relayUrl.protocol)) {
    throw new Error("relay url must use ws:// or wss://");
  }

  const stateDir = resolveOpenClawStateDir(args.stateKey);
  await ensureLocalNodeConfig(stateDir);
  await pruneStaleIdentities(stateDir);
  await cleanupLocalOpenClawRelayProcesses("startup");

  const localRelay = await createLocalRelayServer({
    host: args.listenHost,
    port: args.listenPort,
  });

  console.error(
    `[node-run-helper] local relay listening on ws://${localRelay.host}:${localRelay.port} -> ${relayUrl.toString()}`,
  );

  let shutdownSignal: NodeJS.Signals | null = null;
  let currentAttempt: AttemptHandle | null = null;

  const requestShutdown = (signal: NodeJS.Signals) => {
    if (shutdownSignal) {
      return;
    }
    shutdownSignal = signal;
    currentAttempt?.stop(signal);
  };

  process.on("SIGINT", requestShutdown);
  process.on("SIGTERM", requestShutdown);

  let pairingWaitDeadlineAt: number | null = null;
  let attemptNumber = 0;
  let hasPrunedRejectedIdentity = false;
  let consecutiveInvalidSignatureRotations = 0;

  const reconnectAfter = async (reason: string) => {
    console.error(
      `[node-run-helper] ${reason} — reconnecting in ${args.reconnectDelayMs}ms.`,
    );
    await sleep(args.reconnectDelayMs);
  };

  try {
    while (!shutdownSignal) {
      attemptNumber += 1;
      console.error(
        `[node-run-helper] connecting to relay (attempt ${attemptNumber})...`,
      );
      currentAttempt = startAttempt({
        relayUrl: relayUrl.toString(),
        openclawBin: args.openclawBin,
        host: localRelay.host,
        port: localRelay.port,
        forwardedArgs: args.forwardedArgs,
        stateDir,
        localRelay,
      });

      const outcome = await currentAttempt.promise;
      currentAttempt = null;

      if (shutdownSignal || outcome.kind === "stopped") {
        break;
      }

      if (isConnectTicketExpiredOutcome(outcome)) {
        throw new Error(
          `${buildFatalOutcomeMessage(outcome)} — this connect link has expired or is no longer valid. Generate a new connect link in Dashboard > Devices and try again.`,
        );
      }

      if (isInvalidDeviceSignatureOutcome(outcome)) {
        consecutiveInvalidSignatureRotations += 1;
        if (hasExhaustedDeviceSignatureRotations(consecutiveInvalidSignatureRotations)) {
          throw new Error(
            buildDeviceSignatureRotationExhaustedMessage(consecutiveInvalidSignatureRotations),
          );
        }
        pairingWaitDeadlineAt = null;
        await rotateInvalidLocalNodeIdentity(stateDir);
        if (!hasPrunedRejectedIdentity) {
          hasPrunedRejectedIdentity = true;
          await pruneStaleIdentities(stateDir);
        }
        await reconnectAfter(
          "gateway rejected the persisted device signature; rotated the local pairing identity",
        );
        continue;
      }

      // Any other outcome means the current identity's signature was
      // accepted this attempt — whatever caused earlier rejections (if any)
      // is no longer happening, so don't let a stale count later trip the
      // exhaustion check for an unrelated new episode.
      consecutiveInvalidSignatureRotations = 0;

      const action = decideSupervisorAction({
        outcome,
        now: Date.now(),
        pairingWaitDeadlineAt,
        pairingWaitMs: args.pairingWaitMs,
        pairingRetryMs: args.pairingRetryMs,
      });

      if (action.type === "retry") {
        pairingWaitDeadlineAt = action.pairingWaitDeadlineAt;
        console.error(action.message);
        const waitEnd = Date.now() + action.sleepMs;
        while (!shutdownSignal && Date.now() < waitEnd) {
          await sleep(Math.min(1000, waitEnd - Date.now()));
          if (!shutdownSignal && Date.now() < waitEnd) {
            const remainingSec = Math.ceil(
              (action.pairingWaitDeadlineAt - Date.now()) / 1000,
            );
            console.error(
              `[node-run-helper] still waiting for openclaw:connect:run... (${remainingSec}s before timeout)`,
            );
          }
        }
        continue;
      }

      // Neither the pairing timeout, a fatal relay error, nor any other finish
      // (mission complete or local helper exit) stops this helper by default:
      // only a permanently expired connect ticket or a shutdown signal do.
      pairingWaitDeadlineAt = null;
      await reconnectAfter(action.message ?? "gateway session ended");
      continue;
    }
  } finally {
    process.off("SIGINT", requestShutdown);
    process.off("SIGTERM", requestShutdown);
    currentAttempt?.stop("SIGTERM");
    await localRelay.close();
    await cleanupLocalOpenClawRelayProcesses("shutdown");
  }

  if (shutdownSignal) {
    process.kill(process.pid, shutdownSignal);
    return 1;
  }

  return 0;
}

function parseArgs(argv: string[]): ParsedArgs {
  let relayUrl = "";
  let stateKey = "";
  let listenHost = "127.0.0.1";
  let listenPort = 0;
  let openclawBin = resolveOpenClawBin();
  let pairingWaitMs = DEFAULT_PAIRING_WAIT_MS;
  let pairingRetryMs = DEFAULT_PAIRING_RETRY_MS;
  let reconnect = false;
  let reconnectDelayMs = DEFAULT_RECONNECT_DELAY_MS;
  const forwardedArgs: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--") {
      continue;
    }
    if (arg === "--relay-url") {
      relayUrl = argv[index + 1] ?? "";
      index += 1;
      continue;
    }
    if (arg === "--state-key") {
      stateKey = argv[index + 1] ?? "";
      index += 1;
      continue;
    }
    if (arg === "--listen-host") {
      listenHost = argv[index + 1] ?? listenHost;
      index += 1;
      continue;
    }
    if (arg === "--listen-port") {
      listenPort = parseIntegerOption("--listen-port", argv[index + 1] ?? "", {
        min: 0,
        max: 65535,
      });
      index += 1;
      continue;
    }
    if (arg === "--openclaw-bin") {
      openclawBin = argv[index + 1] ?? openclawBin;
      index += 1;
      continue;
    }
    if (arg === "--pairing-wait-ms") {
      pairingWaitMs = parseIntegerOption(
        "--pairing-wait-ms",
        argv[index + 1] ?? "",
        { min: 1 },
      );
      index += 1;
      continue;
    }
    if (arg === "--pairing-retry-ms") {
      pairingRetryMs = parseIntegerOption(
        "--pairing-retry-ms",
        argv[index + 1] ?? "",
        { min: 1 },
      );
      index += 1;
      continue;
    }
    if (arg === "--reconnect") {
      reconnect = true;
      continue;
    }
    if (arg === "--reconnect-delay-ms") {
      reconnectDelayMs = parseIntegerOption(
        "--reconnect-delay-ms",
        argv[index + 1] ?? "",
        { min: 0 },
      );
      index += 1;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      printHelpAndExit();
    }
    forwardedArgs.push(arg);
  }

  if (!relayUrl.trim()) {
    throw new Error("missing required --relay-url");
  }

  return {
    relayUrl: relayUrl.trim(),
    stateKey: stateKey.trim(),
    listenHost,
    listenPort,
    openclawBin,
    pairingWaitMs,
    pairingRetryMs,
    reconnect,
    reconnectDelayMs,
    forwardedArgs,
  };
}

function parseIntegerOption(
  name: string,
  raw: string,
  bounds: { min: number; max?: number },
): number {
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < bounds.min) {
    throw new Error(`invalid ${name}: ${raw}`);
  }
  if (bounds.max !== undefined && parsed > bounds.max) {
    throw new Error(`invalid ${name}: ${raw}`);
  }
  return parsed;
}

function printHelpAndExit(): never {
  console.error(
    [
      "Usage:",
      "  pnpm openclaw-connect:node-run -- --relay-url <ws(s)://.../connect/<ticket>/gateway> [options] [openclaw node run args]",
      "",
      "Options:",
      "  --state-key <key>           Stable per-instance state key (default: shared helper state)",
      `  --pairing-wait-ms <ms>       How long to wait for dashboard approval before slowing down retries (default ${DEFAULT_PAIRING_WAIT_MS}ms)`,
      `  --pairing-retry-ms <ms>      Retry every ${DEFAULT_PAIRING_RETRY_MS}ms while approval is pending`,
      `  --reconnect-delay-ms <ms>    Delay before retrying after any recoverable error (default ${DEFAULT_RECONNECT_DELAY_MS}ms)`,
      "  --reconnect                  Deprecated, kept for backward compatibility; has no effect (retrying forever is now the default)",
      "",
      "Example:",
      '  pnpm openclaw-connect:node-run -- --relay-url "wss://<your-relay-host>/connect/<ticket>/gateway" --display-name "My Computer"',
      "",
      "Behavior:",
      "  This helper stays alive and keeps retrying on any recoverable error (pairing not yet approved, expired device signature, transient relay/network errors, etc.), with no need to pass --reconnect. It only stops on Ctrl-C/SIGTERM or when the connect ticket in the relay URL has permanently expired or been removed — in that case, generate a new connect link from Dashboard > Devices.",
    ].join("\n"),
  );
  process.exit(0);
}

const isDirectExecution =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectExecution) {
  void main()
    .then((exitCode) => {
      process.exit(exitCode);
    })
    .catch((error) => {
      console.error(
        `[node-run-helper] ${error instanceof Error ? error.message : String(error)}`,
      );
      process.exit(1);
    });
}
