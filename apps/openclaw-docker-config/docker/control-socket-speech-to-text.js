"use strict";

function resolveSpeechToTextConfigRequest({
  provider,
  enabled,
  apiKey,
  existingApiKey,
}) {
  const normalizedProvider =
    typeof provider === "string" ? provider.trim().toLowerCase() : "";
  const normalizedApiKey =
    typeof apiKey === "string" ? apiKey.trim() : "";
  const currentApiKey =
    typeof existingApiKey === "string" ? existingApiKey.trim() : "";

  if (normalizedProvider !== "groq") {
    return {
      ok: false,
      error: "provider must be groq",
    };
  }

  if (enabled && !normalizedApiKey && !currentApiKey) {
    return {
      ok: false,
      error: "GROQ_API_KEY is required before enabling speech-to-text",
    };
  }

  return {
    ok: true,
    provider: normalizedProvider,
    enabled: enabled === true,
    apiKeyToPersist: normalizedApiKey || null,
  };
}

async function applySpeechToTextConfig(deps, resolved) {
  const { runCommandCapture, log, configTimeoutMs } = deps;

  if (resolved.apiKeyToPersist) {
    await runCommandCapture(
      "openclaw",
      [
        "config",
        "set",
        "--json",
        "env.vars.GROQ_API_KEY",
        JSON.stringify(resolved.apiKeyToPersist),
      ],
      configTimeoutMs,
    );
  }

  await runCommandCapture(
    "openclaw",
    [
      "config",
      "set",
      "--json",
      "tools.media.audio.enabled",
      JSON.stringify(resolved.enabled),
    ],
    configTimeoutMs,
  );
  await runCommandCapture(
    "openclaw",
    [
      "config",
      "set",
      "--json",
      "tools.media.audio.models",
      JSON.stringify([{ provider: resolved.provider }]),
    ],
    configTimeoutMs,
  );
  await runCommandCapture(
    "openclaw",
    [
      "config",
      "set",
      "--json",
      "tools.media.audio.echoTranscript",
      JSON.stringify(false),
    ],
    configTimeoutMs,
  );

  log("speech-to-text config: applied");
}

async function handleSpeechToTextConfigRequest(deps, body) {
  const { readOpenClawConfigValue, log } = deps;
  const configuredApiKey = await readOpenClawConfigValue("env.vars.GROQ_API_KEY");
  const existingApiKey =
    (typeof configuredApiKey === "string" ? configuredApiKey : "") ||
    process.env.GROQ_API_KEY ||
    "";

  const resolved = resolveSpeechToTextConfigRequest({
    provider: body.provider,
    enabled: body.enabled === true,
    apiKey: body.apiKey,
    existingApiKey,
  });

  if (!resolved.ok) {
    return { status: 400, body: { ok: false, error: resolved.error } };
  }

  log(
    `speech-to-text config: setting ${resolved.provider} enabled=${resolved.enabled}`,
  );

  await applySpeechToTextConfig(deps, resolved);

  return {
    status: 200,
    body: {
      ok: true,
      data: {
        output: `Groq speech-to-text ${resolved.enabled ? "enabled" : "disabled"}.`,
        provider: resolved.provider,
        enabled: resolved.enabled,
      },
    },
  };
}

module.exports = {
  resolveSpeechToTextConfigRequest,
  applySpeechToTextConfig,
  handleSpeechToTextConfigRequest,
};
