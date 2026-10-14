const {
  handleSpeechToTextConfigRequest,
} = require("./control-socket-speech-to-text");

const PROVIDER_ENV_KEYS = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  xiaomi: "XIAOMI_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
};

function createChannelWorkflow({
  runCommandCapture,
  configTimeoutMs,
  readOpenClawConfigValue,
  log,
  scheduleGatewayContainerRestart,
}) {
  function modelIdFromRef(modelRef) {
    const normalized = typeof modelRef === "string" ? modelRef.trim() : "";
    if (!normalized) {
      return "";
    }
    const withoutParams = normalized.split(":", 1)[0] || normalized;
    const parts = withoutParams.split("/").filter(Boolean);
    return parts[parts.length - 1] || withoutParams;
  }

  function xiaomiModelConfigFor(modelRef) {
    const modelId = modelIdFromRef(modelRef);
    if (modelId !== "mimo-v2.5" && modelId !== "mimo-v2.5-pro") {
      return null;
    }
    return {
      id: modelId,
      name: modelId === "mimo-v2.5" ? "Xiaomi MiMo V2.5" : "Xiaomi MiMo V2.5 Pro",
      input: ["text"],
      reasoning: true,
      contextWindow: 1048576,
      maxTokens: 32000,
      compat: {
        supportsReasoningEffort: false,
        thinkingFormat: "openai",
        requiresReasoningContentOnAssistantMessages: false,
      },
    };
  }

  async function configureWhatsApp(body = {}) {
    const phoneNumber =
      typeof body.phoneNumber === "string" ? body.phoneNumber.trim() : "";
    if (phoneNumber && !/^\+[1-9]\d{5,19}$/.test(phoneNumber)) {
      return {
        status: 400,
        body: {
          ok: false,
          error:
            "WhatsApp number must be in E.164 format, for example +33612345678",
          data: { output: "", phoneNumber },
        },
      };
    }

    if (typeof body.enabled === "boolean" && !phoneNumber) {
      log(`whatsapp config: setting enabled=${body.enabled}`);
      await runCommandCapture(
        "openclaw",
        ["config", "set", "--merge", "--json", "channels.whatsapp", JSON.stringify({ enabled: body.enabled })],
        configTimeoutMs,
      );
      log("whatsapp config: applied — scheduling gateway restart to apply it");
      return {
        status: 200,
        body: {
          ok: true,
          data: {
            output: body.enabled ? "WhatsApp channel enabled." : "WhatsApp channel disabled.",
            enabled: body.enabled,
          },
        },
        afterResponse: scheduleGatewayContainerRestart,
      };
    }

    log(
      `whatsapp config: applying ${
        phoneNumber ? `self-chat for ${phoneNumber}` : "pairing mode"
      }`,
    );
    let nextConfig;
    if (phoneNumber) {
      const existing = await readOpenClawConfigValue("channels.whatsapp");
      const existingAllowFrom =
        existing && Array.isArray(existing.allowFrom) ? existing.allowFrom : [];
      // Drop "*" before merging in the self-chat number — carrying it over
      // would leave every sender authorized instead of just this number.
      const allowFrom = Array.from(
        new Set([...existingAllowFrom.filter((entry) => entry !== "*"), phoneNumber]),
      );
      nextConfig = { dmPolicy: "allowlist", allowFrom, selfChatMode: true };
    } else {
      // --merge only overwrites keys present here, so allowFrom and
      // selfChatMode must be cleared explicitly or a prior self-chat setup
      // keeps applying after resetting to pairing mode.
      nextConfig = { dmPolicy: "pairing", allowFrom: [], selfChatMode: false };
    }
    await runCommandCapture(
      "openclaw",
      ["config", "set", "--merge", "--json", "channels.whatsapp", JSON.stringify(nextConfig)],
      configTimeoutMs,
    );
    log("whatsapp config: applied — scheduling gateway restart to apply it");
    return {
      status: 200,
      body: {
        ok: true,
        data: {
          output: phoneNumber
            ? `WhatsApp number saved for ${phoneNumber}.`
            : "WhatsApp DM policy reset to pairing mode.",
          phoneNumber,
        },
      },
      afterResponse: scheduleGatewayContainerRestart,
    };
  }

  async function configureTelegram(body = {}) {
    const botToken =
      typeof body.botToken === "string" ? body.botToken.trim() : "";
    const dmPolicy =
      typeof body.dmPolicy === "string" ? body.dmPolicy.trim() : "open";
    if (!botToken) {
      return {
        status: 400,
        body: { ok: false, error: "Telegram bot token is required" },
      };
    }
    log(`telegram config: setting bot token (dmPolicy=${dmPolicy})`);
    await runCommandCapture(
      "openclaw",
      [
        "config",
        "set",
        "--json",
        "channels.telegram",
        JSON.stringify({ botToken, dmPolicy }),
      ],
      configTimeoutMs,
    );
    log("telegram config: applied");
    return {
      status: 200,
      body: { ok: true, data: { output: "Telegram configured." } },
    };
  }

  async function configureAi(body = {}) {
    const provider =
      typeof body.provider === "string" ? body.provider.trim() : "";
    const apiKey = typeof body.apiKey === "string" ? body.apiKey.trim() : "";
    const model = typeof body.model === "string" ? body.model.trim() : "";
    const baseUrl =
      typeof body.baseUrl === "string" ? body.baseUrl.trim() : "";
    if (!provider || !model) {
      return {
        status: 400,
        body: { ok: false, error: "provider and model are required" },
      };
    }
    const envKey = PROVIDER_ENV_KEYS[provider];
    if (!envKey) {
      return {
        status: 400,
        body: {
          ok: false,
          error: `Unsupported provider: ${provider}. Supported: ${Object.keys(PROVIDER_ENV_KEYS).join(", ")}`,
        },
      };
    }

    const needsAuthProfile = provider === "anthropic" || provider === "openai";
    const profileKey = `${provider}:default`;
    log(
      `ai config: setting ${provider} model ${model}${
        baseUrl ? ` baseUrl=${baseUrl}` : ""
      }${apiKey ? "" : " (keeping existing apiKey)"}`,
    );
    if (apiKey) {
      await runCommandCapture(
        "openclaw",
        ["config", "set", "--json", `env.vars.${envKey}`, JSON.stringify(apiKey)],
        configTimeoutMs,
      );
    }
    await runCommandCapture(
      "openclaw",
      [
        "config",
        "set",
        "--json",
        "agents.defaults.model",
        JSON.stringify({ primary: model }),
      ],
      configTimeoutMs,
    );
    if (needsAuthProfile) {
      await runCommandCapture(
        "openclaw",
        [
          "config",
          "set",
          "--json",
          "auth.profiles",
          JSON.stringify({ [profileKey]: { provider, mode: "api-key" } }),
        ],
        configTimeoutMs,
      );
    }
    if (baseUrl || !needsAuthProfile) {
      const modelConfig = xiaomiModelConfigFor(model);
      await runCommandCapture(
        "openclaw",
        [
          "config",
          "set",
          "--merge",
          "--json",
          `models.providers.${provider}`,
          JSON.stringify({
            ...(baseUrl ? { baseUrl } : {}),
            apiKey: envKey,
            api: "openai-completions",
            ...(modelConfig ? { models: [modelConfig] } : {}),
          }),
        ],
        configTimeoutMs,
      );
    }
    log("ai config: applied");
    return {
      status: 200,
      body: {
        ok: true,
        data: {
          output: `${provider} configured with model ${model}.`,
          provider,
          model,
        },
      },
    };
  }

  async function configureSpeechToText(body = {}) {
    return handleSpeechToTextConfigRequest(
      {
        runCommandCapture,
        readOpenClawConfigValue,
        log,
        configTimeoutMs,
      },
      body,
    );
  }

  return {
    configureAi,
    configureSpeechToText,
    configureTelegram,
    configureWhatsApp,
  };
}

module.exports = { createChannelWorkflow };
