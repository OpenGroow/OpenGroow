import { type ChildProcess, spawn } from "node:child_process";
import { once } from "node:events";
import { WebSocket, WebSocketServer } from "ws";
import { type AttemptOutcome } from "./node-run-supervisor.js";
import { parseRawProtocols, truncateCloseReason } from "./ws-utils.js";

const CONNECTION_STABLE_WINDOW_MS = 5_000;
const CHILD_EXIT_TIMEOUT_MS = 1_500;

export type ActiveBridge = {
  upstreamWs: WebSocket;
  clientWs: WebSocket | null;
  bufferedUpstreamFrames: Array<{
    data: WebSocket.RawData;
    isBinary: boolean;
  }>;
  onLocalClientConnected: () => void;
  onLocalClientClose: (reason: string) => void;
  onLocalClientError: (reason: string) => void;
};

export type LocalRelayServer = {
  host: string;
  port: number;
  setActiveBridge: (bridge: ActiveBridge | null) => void;
  close: () => Promise<void>;
};

export type AttemptHandle = {
  promise: Promise<AttemptOutcome>;
  stop: (signal?: NodeJS.Signals) => void;
};

export async function createLocalRelayServer({
  host,
  port,
}: {
  host: string;
  port: number;
}): Promise<LocalRelayServer> {
  let activeBridge: ActiveBridge | null = null;
  const localWss = new WebSocketServer({ host, port });

  localWss.on("connection", (nextClientWs, req) => {
    const bridge = activeBridge;
    if (!bridge) {
      nextClientWs.close(1013, "node helper is not ready for a local client");
      return;
    }

    const requestedProtocols = parseRawProtocols(
      req.headers["sec-websocket-protocol"],
    );
    if (requestedProtocols.length > 0) {
      console.error(
        `[node-run-helper] warning: local protocols requested but upstream was pre-opened without them: ${requestedProtocols.join(", ")}`,
      );
    }
    if (bridge.clientWs && bridge.clientWs.readyState === WebSocket.OPEN) {
      nextClientWs.close(1013, "node helper already has an active local client");
      return;
    }

    bridge.clientWs = nextClientWs;
    bridge.onLocalClientConnected();

    while (bridge.bufferedUpstreamFrames.length > 0) {
      const frame = bridge.bufferedUpstreamFrames.shift();
      if (!frame || nextClientWs.readyState !== WebSocket.OPEN) {
        break;
      }
      nextClientWs.send(frame.data, { binary: frame.isBinary });
    }

    nextClientWs.on("message", (data, isBinary) => {
      if (bridge.upstreamWs.readyState !== WebSocket.OPEN) {
        return;
      }
      bridge.upstreamWs.send(data, { binary: isBinary });
    });

    nextClientWs.on("close", () => {
      if (bridge.clientWs === nextClientWs) {
        bridge.clientWs = null;
      }
      bridge.onLocalClientClose("Local node disconnected");
    });

    nextClientWs.on("error", (error) => {
      console.error(
        `[node-run-helper] local node socket error: ${error.message}`,
      );
      bridge.onLocalClientError(error.message || "local node socket error");
    });
  });

  await once(localWss, "listening");
  const address = localWss.address();
  if (!address || typeof address === "string") {
    throw new Error("failed to resolve local proxy address");
  }

  return {
    host,
    port: address.port,
    setActiveBridge(nextBridge) {
      activeBridge = nextBridge;
    },
    async close() {
      await new Promise<void>((resolve) => {
        localWss.close(() => resolve());
      });
    },
  };
}

export function startAttempt(params: {
  relayUrl: string;
  openclawBin: string;
  host: string;
  port: number;
  forwardedArgs: string[];
  stateDir: string;
  localRelay: LocalRelayServer;
}): AttemptHandle {
  let child: ChildProcess | null = null;
  let localClientConnected = false;
  let stable = false;
  let stableTimer: ReturnType<typeof setTimeout> | null = null;
  let resolved = false;

  let resolvePromise!: (outcome: AttemptOutcome) => void;
  const promise = new Promise<AttemptOutcome>((resolve) => {
    resolvePromise = resolve;
  });

  const upstreamWs = new WebSocket(params.relayUrl);
  const bridge: ActiveBridge = {
    upstreamWs,
    clientWs: null,
    bufferedUpstreamFrames: [],
    onLocalClientConnected() {
      if (localClientConnected) {
        return;
      }
      localClientConnected = true;
      if (!stableTimer) {
        stableTimer = setTimeout(() => {
          stable = true;
          console.error(
            "[node-run-helper] connection remained open long enough; treating the remote session as established.",
          );
        }, CONNECTION_STABLE_WINDOW_MS);
        stableTimer.unref?.();
      }
    },
    onLocalClientClose(reason) {
      if (isSocketOpenOrConnecting(upstreamWs)) {
        upstreamWs.close(1000, truncateCloseReason(reason));
      }
    },
    onLocalClientError(reason) {
      if (isSocketOpenOrConnecting(upstreamWs)) {
        upstreamWs.close(1011, truncateCloseReason(reason));
      }
    },
  };

  params.localRelay.setActiveBridge(bridge);

  const finalize = (outcome: AttemptOutcome) => {
    if (resolved) {
      return;
    }
    resolved = true;

    void (async () => {
      try {
        if (stableTimer) {
          clearTimeout(stableTimer);
          stableTimer = null;
        }

        params.localRelay.setActiveBridge(null);

        const clientWs = bridge.clientWs;
        bridge.clientWs = null;
        if (clientWs && isSocketOpenOrConnecting(clientWs)) {
          clientWs.close(
            toClientCloseCode(outcome),
            truncateCloseReason(getOutcomeCloseReason(outcome)),
          );
        }

        if (outcome.kind === "stopped") {
          if (child && !hasChildExited(child)) {
            await stopChildProcess(child, outcome.signal ?? "SIGTERM");
          }
        } else if (
          outcome.kind !== "child_exit" &&
          child &&
          !hasChildExited(child)
        ) {
          await stopChildProcess(child, "SIGTERM");
        }

        if (isSocketOpenOrConnecting(upstreamWs)) {
          upstreamWs.close(1000, "Attempt finished");
        }
      } finally {
        resolvePromise(outcome);
      }
    })();
  };

  upstreamWs.on("open", () => {
    if (resolved || child) {
      return;
    }

    child = launchOpenClawNodeRun({
      openclawBin: params.openclawBin,
      host: params.host,
      port: params.port,
      forwardedArgs: params.forwardedArgs,
      stateDir: params.stateDir,
    });

    child.on("error", (error) => {
      finalize({
        kind: "child_error",
        stable,
        localClientConnected,
        error: error.message || "child process error",
      });
    });

    child.on("exit", (code, signal) => {
      finalize({
        kind: "child_exit",
        stable,
        localClientConnected,
        exitCode: code ?? 1,
        signal: signal ?? undefined,
      });
    });
  });

  upstreamWs.on("message", (data, isBinary) => {
    if (bridge.clientWs?.readyState === WebSocket.OPEN) {
      bridge.clientWs.send(data, { binary: isBinary });
      return;
    }
    bridge.bufferedUpstreamFrames.push({ data, isBinary });
  });

  upstreamWs.on("close", (code, reason) => {
    finalize({
      kind: "upstream_close",
      stable,
      localClientConnected,
      code,
      reason: reason.toString(),
    });
  });

  upstreamWs.on("error", (error) => {
    console.error(`[node-run-helper] upstream relay error: ${error.message}`);
    finalize({
      kind: "upstream_error",
      stable,
      localClientConnected,
      error: error.message || "upstream relay error",
    });
  });

  return {
    promise,
    stop(signal = "SIGTERM") {
      finalize({ kind: "stopped", stable, localClientConnected, signal });
    },
  };
}

export function launchOpenClawNodeRun(params: {
  openclawBin: string;
  host: string;
  port: number;
  forwardedArgs: string[];
  stateDir: string;
}): ChildProcess {
  const env = { ...process.env };
  env.OPENCLAW_STATE_DIR = params.stateDir;

  const args = [
    "node",
    "run",
    "--host",
    params.host,
    "--port",
    String(params.port),
    ...params.forwardedArgs,
  ];

  console.error(
    `[node-run-helper] using OPENCLAW_STATE_DIR=${env.OPENCLAW_STATE_DIR}`,
  );
  console.error(
    `[node-run-helper] launching: ${params.openclawBin} ${args.join(" ")}`,
  );
  return spawn(params.openclawBin, args, { stdio: "inherit", env });
}

function getOutcomeCloseReason(outcome: AttemptOutcome): string {
  if (outcome.kind === "upstream_close") {
    return outcome.reason || "Relay closed";
  }
  if (outcome.kind === "upstream_error") {
    return outcome.error || "Relay error";
  }
  if (outcome.kind === "child_error") {
    return outcome.error || "Local helper error";
  }
  if (outcome.kind === "child_exit") {
    return `Local helper exited with code ${outcome.exitCode}`;
  }
  return "Helper stopped";
}

function toClientCloseCode(outcome: AttemptOutcome): number {
  if (outcome.kind === "upstream_close") {
    return outcome.code === 1008 ? 1008 : 1011;
  }
  return 1011;
}

function isSocketOpenOrConnecting(socket: WebSocket): boolean {
  return (
    socket.readyState === WebSocket.OPEN ||
    socket.readyState === WebSocket.CONNECTING
  );
}

function hasChildExited(child: ChildProcess): boolean {
  return child.exitCode !== null || child.signalCode !== null;
}

async function stopChildProcess(
  child: ChildProcess,
  signal: NodeJS.Signals,
): Promise<void> {
  if (hasChildExited(child)) {
    return;
  }

  try {
    child.kill(signal);
  } catch {
    return;
  }

  await waitForChildExit(child, CHILD_EXIT_TIMEOUT_MS);
  if (hasChildExited(child)) {
    return;
  }

  try {
    child.kill("SIGKILL");
  } catch {
    return;
  }
  await waitForChildExit(child, CHILD_EXIT_TIMEOUT_MS);
}

async function waitForChildExit(
  child: ChildProcess,
  timeoutMs: number,
): Promise<void> {
  if (hasChildExited(child)) {
    return;
  }

  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      child.off("exit", handleExit);
      child.off("error", handleError);
      resolve();
    }, timeoutMs);
    timer.unref?.();

    const handleExit = () => {
      clearTimeout(timer);
      child.off("error", handleError);
      resolve();
    };

    const handleError = () => {
      clearTimeout(timer);
      child.off("exit", handleExit);
      resolve();
    };

    child.once("exit", handleExit);
    child.once("error", handleError);
  });
}
