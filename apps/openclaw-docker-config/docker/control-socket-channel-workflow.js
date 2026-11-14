const {
  handleSpeechToTextConfigRequest,
} = require("./control-socket-speech-to-text");

const { createAiWorkflow } = require("./control-socket-ai-workflow");

function createChannelWorkflow(options) {
  const {
    runCommandCapture,
    configTimeoutMs,
    readOpenClawConfigValue,
    log,
    scheduleGatewayContainerRestart,
  } = options;
  const { configureAi } = createAiWorkflow(options);

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
