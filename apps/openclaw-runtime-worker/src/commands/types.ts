import type { Command, EventMessage } from "@opengroow/protocol";
import type { BrokerClient } from "../broker/broker-client.js";
import type { GatewayControlClient } from "../gateway/gateway-control-client.js";
import type { OpenClawCommandRunner } from "../process/openclaw-command-runner.js";

export type RuntimeDeps = {
  broker: BrokerClient;
  gatewayClient: GatewayControlClient;
  openclawRunner: OpenClawCommandRunner;
  getRuntimeInstanceId: () => string;
  log: (message: string) => void;
  warn: (message: string) => void;
  writeAgentCredential: (agentId: string, apiKey: string) => Promise<void>;
};

export type CommandHandler = (
  command: Command,
  deps: RuntimeDeps,
) => Promise<EventMessage>;
