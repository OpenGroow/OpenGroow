import type {
  Command,
  RelayCloseMessage,
  RelayDataMessage,
  RelayOpenMessage,
} from "@opengroow/protocol";
import { loadRuntimeWorkerConfig } from "./config/runtime-worker-config.js";
import { GatewayControlClient } from "./gateway/gateway-control-client.js";
import { OpenClawCommandRunner } from "./process/openclaw-command-runner.js";
import { BrokerClient } from "./broker/broker-client.js";
import { RelayManager } from "./relay/relay-manager.js";
import { CommandRouter } from "./commands/command-router.js";
import { createAgentCredentialWriter } from "./agent-credential-store.js";

function log(message: string): void {
  console.log(`[runtime-worker] ${message}`);
}

function warn(message: string): void {
  console.warn(`[runtime-worker] ${message}`);
}

const config = loadRuntimeWorkerConfig();
const gatewayClient = new GatewayControlClient(config.openclawControlSocketPath);
const openclawRunner = new OpenClawCommandRunner();

let broker: BrokerClient;
let relayManager: RelayManager;
let commandRouter: CommandRouter;

broker = new BrokerClient({
  config,
  log,
  warn,
  onCommand: (command: Command) => {
    void commandRouter.handleCommand(command);
  },
  onRelayOpen: (message: RelayOpenMessage) => {
    void relayManager.handleRelayOpen(message);
  },
  onRelayData: (message: RelayDataMessage) => {
    relayManager.handleRelayData(message);
  },
  onRelayClose: (message: RelayCloseMessage) => {
    relayManager.handleRelayClose(message);
  },
  onDisconnected: () => {
    relayManager.closeAllRelaySessions();
  },
});

relayManager = new RelayManager(broker, config.openclawGatewayLocalPort);
commandRouter = new CommandRouter({
  broker,
  gatewayClient,
  openclawRunner,
  getRuntimeInstanceId: () => broker.getRuntimeInstanceId(),
  log,
  warn,
  writeAgentCredential: createAgentCredentialWriter(config.openclawConfigDir),
});

broker.start();
