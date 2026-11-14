const { readGatewayDefaultModel: readDefaultModel } = require("./control-socket-openclaw");

const PROVIDER_ENV_KEYS = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  xiaomi: "XIAOMI_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
};

function createAiWorkflow({
  runCommandCapture,
  configTimeoutMs,
  log,
  readGatewayDefaultModel = readDefaultModel,
  now = Date.now,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
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

  async function waitForActivation(provider, model) {
    const deadline = now() + configTimeoutMs;
    const bareModel = model.startsWith(`${provider}/`) ? model.slice(provider.length + 1) : model;
    while (now() < deadline) {
      try {
        // This comes from the running Gateway, rather than config get (disk).
        const active = await readGatewayDefaultModel({ timeoutMs: Math.min(2500, deadline - now()) });
        const activeModel = active?.model?.startsWith(`${provider}/`)
          ? active.model.slice(provider.length + 1)
          : active?.model;
        if (active?.provider === provider && activeModel === bareModel) return;
      } catch {
        // The socket can close while OpenClaw restarts after loading the key.
        // Do not surface transport errors (which can contain credential data).
      }
      const remaining = deadline - now();
      if (remaining > 0) await sleep(Math.min(500, remaining));
    }
    throw new Error(`Configuration saved, but the running Gateway did not activate ${provider} model ${model}. Retry after the Gateway is ready.`);
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
    // A key change can restart the Gateway. Commit the model and provider in
    // the same write so that restart cannot capture a partially updated config.
    const operations = [];
    if (apiKey) {
      operations.push({ path: "env.vars", value: { [envKey]: apiKey } });
    }
    operations.push({ path: "agents.defaults.model", value: { primary: model } });
    if (needsAuthProfile) {
      operations.push({
        path: "auth.profiles",
        value: { [profileKey]: { provider, mode: "api_key" } },
      });
    }
    if (baseUrl || !needsAuthProfile) {
      const modelConfig = xiaomiModelConfigFor(model);
      operations.push({
        path: `models.providers.${provider}`,
        value: {
          ...(baseUrl ? { baseUrl } : {}),
          apiKey: envKey,
          api: "openai-completions",
          ...(modelConfig ? { models: [modelConfig] } : {}),
        },
      });
    }
    await runCommandCapture(
      "openclaw",
      ["config", "set", "--merge", "--batch-json", JSON.stringify(operations)],
      configTimeoutMs,
    );
    await waitForActivation(provider, model);
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

  return { configureAi };
}

module.exports = { createAiWorkflow };
