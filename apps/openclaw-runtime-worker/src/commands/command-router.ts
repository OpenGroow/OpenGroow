import {
  RUNTIME_AGENT_REGISTER_AND_CONFIGURE,
  RUNTIME_AI_CONFIG_SET,
  RUNTIME_COMMAND_UNSUPPORTED,
  RUNTIME_AUTH_ACTIVATE,
  RUNTIME_AUTH_CANCEL,
  RUNTIME_AUTH_INPUT,
  RUNTIME_AUTH_ORDER_ACTIVATE,
  RUNTIME_AUTH_START,
  RUNTIME_AUTH_STATUS,
  RUNTIME_HEALTH_CHECK,
  RUNTIME_MCP_SERVERS_MERGE,
  RUNTIME_MCP_SERVERS_REMOVE,
  RUNTIME_NODES_APPROVE,
  RUNTIME_NODES_CHECK,
  RUNTIME_NODES_CLEANUP_STALE,
  RUNTIME_NODES_PENDING_LIST,
  RUNTIME_OPENCLAW_EXEC,
  RUNTIME_OPENCLAW_EXEC_CANCEL,
  RUNTIME_SESSION_TRANSCRIPT_READ,
  RUNTIME_SKILLS_INSTALL_BATCH,
  RUNTIME_SPEECH_TO_TEXT_CONFIG_SET,
  RUNTIME_TELEGRAM_CONFIG_SET,
  RUNTIME_WORKSPACE_CREATE,
  RUNTIME_WORKSPACE_FILE_DELETE,
  RUNTIME_WORKSPACE_FILE_DELETE_BATCH,
  RUNTIME_WORKSPACE_FILE_READ,
  RUNTIME_WORKSPACE_FILE_WRITE,
  RUNTIME_WORKSPACE_LIST,
  RUNTIME_WORKSPACE_SKILL_FILES,
  RUNTIME_WHATSAPP_CONFIG_SET,
  RUNTIME_WHATSAPP_PAIR_START,
  RUNTIME_WHATSAPP_PAIR_WAIT,
  RUNTIME_AGENT_CREDENTIAL_SET,
  RUNTIME_PLUGINS_INSTALL,
  type Command,
} from "@opengroow/protocol";
import { createEventMessage } from "./event-message.js";
import {
  handleAuthActivate,
  handleAuthCancel,
  handleAuthInput,
  handleAuthOrderActivate,
  handleAuthStart,
  handleAuthStatus,
} from "./auth-commands.js";
import {
  handleAiConfigSet,
  handleOpenClawExec,
  handleOpenClawExecCancel,
  handleSpeechToTextConfigSet,
  handleTelegramConfigSet,
} from "./config-commands.js";
import {
  handleMcpServersMerge,
  handleMcpServersRemove,
} from "./mcp-commands.js";
import { handleSessionTranscriptRead } from "./session-commands.js";
import {
  handleAgentRegisterAndConfigure,
  handleSkillsInstallBatch,
} from "./compound-commands.js";
import {
  handleNodeApprove,
  handleNodesCheck,
  handleNodesCleanupStale,
  handleNodesPendingList,
  handleRuntimeHealthCheck,
} from "./node-commands.js";
import type { CommandHandler, RuntimeDeps } from "./types.js";
import {
  handleWhatsAppConfigSet,
  handleWhatsAppPairStart,
  handleWhatsAppPairWait,
} from "./whatsapp-commands.js";
import {
  handleWorkspaceCreate,
  handleWorkspaceFileDelete,
  handleWorkspaceFileDeleteBatch,
  handleWorkspaceFileRead,
  handleWorkspaceFileWrite,
  handleWorkspaceList,
  handleWorkspaceSkillFiles,
} from "./workspace-commands.js";
import { handleAgentCredentialSet } from "./agent-credentials.js";
import { handlePluginsInstall } from "./plugins-commands.js";
import { CommandRegistry } from "../broker/command-registry.js";

const COMMAND_HANDLERS = new Map<string, CommandHandler>([
  [RUNTIME_NODES_PENDING_LIST, handleNodesPendingList],
  [RUNTIME_HEALTH_CHECK, handleRuntimeHealthCheck],
  [RUNTIME_NODES_APPROVE, handleNodeApprove],
  [RUNTIME_NODES_CHECK, handleNodesCheck],
  [RUNTIME_NODES_CLEANUP_STALE, handleNodesCleanupStale],
  [RUNTIME_WHATSAPP_PAIR_START, handleWhatsAppPairStart],
  [RUNTIME_WHATSAPP_PAIR_WAIT, handleWhatsAppPairWait],
  [RUNTIME_WHATSAPP_CONFIG_SET, handleWhatsAppConfigSet],
  [RUNTIME_TELEGRAM_CONFIG_SET, handleTelegramConfigSet],
  [RUNTIME_AI_CONFIG_SET, handleAiConfigSet],
  [RUNTIME_SPEECH_TO_TEXT_CONFIG_SET, handleSpeechToTextConfigSet],
  [RUNTIME_AUTH_START, handleAuthStart],
  [RUNTIME_AUTH_STATUS, handleAuthStatus],
  [RUNTIME_AUTH_INPUT, handleAuthInput],
  [RUNTIME_AUTH_CANCEL, handleAuthCancel],
  [RUNTIME_AUTH_ACTIVATE, handleAuthActivate],
  [RUNTIME_AUTH_ORDER_ACTIVATE, handleAuthOrderActivate],
  [RUNTIME_OPENCLAW_EXEC, handleOpenClawExec],
  [RUNTIME_OPENCLAW_EXEC_CANCEL, handleOpenClawExecCancel],
  [RUNTIME_WORKSPACE_LIST, handleWorkspaceList],
  [RUNTIME_WORKSPACE_SKILL_FILES, handleWorkspaceSkillFiles],
  [RUNTIME_WORKSPACE_FILE_READ, handleWorkspaceFileRead],
  [RUNTIME_WORKSPACE_FILE_DELETE, handleWorkspaceFileDelete],
  [RUNTIME_WORKSPACE_FILE_DELETE_BATCH, handleWorkspaceFileDeleteBatch],
  [RUNTIME_WORKSPACE_CREATE, handleWorkspaceCreate],
  [RUNTIME_WORKSPACE_FILE_WRITE, handleWorkspaceFileWrite],
  [RUNTIME_MCP_SERVERS_MERGE, handleMcpServersMerge],
  [RUNTIME_MCP_SERVERS_REMOVE, handleMcpServersRemove],
  [RUNTIME_SESSION_TRANSCRIPT_READ, handleSessionTranscriptRead],
  [RUNTIME_SKILLS_INSTALL_BATCH, handleSkillsInstallBatch],
  [RUNTIME_AGENT_REGISTER_AND_CONFIGURE, handleAgentRegisterAndConfigure],
  [RUNTIME_AGENT_CREDENTIAL_SET, handleAgentCredentialSet],
  [RUNTIME_PLUGINS_INSTALL, handlePluginsInstall],
]);

export class CommandRouter {
  constructor(
    private readonly deps: RuntimeDeps,
    private readonly registry = new CommandRegistry(),
  ) {}

  // `command` is guaranteed to have a string id/type/ts and a record-or-
  // undefined payload — broker-client.ts only calls onCommand with the
  // `.command` field of a message that already passed
  // parseValidatedMessage(raw, "runtime"), which validates exactly that
  // shape (see validateCommand in @opengroow/protocol). No local re-check
  // is needed here.
  async handleCommand(command: Command): Promise<void> {
    this.deps.log(`command received commandId=${command.id} type=${command.type}`);

    const existing = this.registry.get(command.id);
    if (existing?.status === "completed") {
      this.deps.broker.enqueueAck(command.id);
      this.deps.broker.enqueueMessage(existing.resultMessage);
      return;
    }
    if (existing?.status === "in_progress") {
      this.deps.broker.enqueueAck(command.id);
      return;
    }

    this.registry.markInProgress(command.id);
    this.deps.broker.enqueueAck(command.id);

    const result = await this.dispatch(command);
    this.registry.markCompleted(command.id, result);
    this.deps.broker.enqueueMessage(result);
  }

  private async dispatch(command: Command) {
    const handler = COMMAND_HANDLERS.get(command.type);
    if (!handler) {
      this.deps.warn(
        `command rejected by allowlist commandId=${command.id} type=${command.type}`,
      );
      return createEventMessage(RUNTIME_COMMAND_UNSUPPORTED, command.id, {
        commandId: command.id,
        instanceId: this.deps.getRuntimeInstanceId(),
        ok: false,
        error: `Unsupported command type: ${command.type}`,
      });
    }
    return await handler(command, this.deps);
  }
}
