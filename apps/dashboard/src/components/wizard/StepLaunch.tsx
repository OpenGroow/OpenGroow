"use client";

import { useAction } from "convex/react";
import { api } from "../../../../convex/_generated/api.js";
import { useSession } from "@/src/lib/auth-client";
import { useRouter } from "next/navigation";
import { useState } from "react";

interface StepLaunchProps {
  provider: string;
  model: string;
  channel: string;
  onBack: () => void;
}

type DeployPhase =
  | "idle"
  | "creating"
  | "provisioning"
  | "configuring"
  | "done"
  | "error";

const PHASE_LABELS: Record<DeployPhase, string> = {
  idle: "",
  creating: "Creating your VPS…",
  provisioning: "Provisioning server (this takes ~3 min)…",
  configuring: "Configuring AI and channel…",
  done: "Your assistant is live!",
  error: "Something went wrong"
};

const PROVIDER_LABELS: Record<string, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
};

export function StepLaunch({ provider, model, channel, onBack }: StepLaunchProps) {
  const allowUnauthenticatedCreate = process.env.NODE_ENV !== "production";
  const { data: session } = useSession();
  const router = useRouter();
  const [apiKey, setApiKey] = useState("");
  const [telegramToken, setTelegramToken] = useState("");
  const [phase, setPhase] = useState<DeployPhase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);

  const createJob = useAction(api.instances_node.createJob);
  const refreshJob = useAction(api.instances_node.refreshJob);
  const configureAiProvider = useAction(api.project_provider_operations.configureAiProvider);
  const configureTelegram = useAction(api.project_channel_operations.configureTelegram);
  const startWhatsAppPairing = useAction(api.project_channel_operations.startWhatsAppPairing);

  const canDeploy =
    apiKey.trim().length > 10 &&
    (channel !== "telegram" || telegramToken.trim().length > 10);

  const deploy = async () => {
    if (!allowUnauthenticatedCreate && !session?.user) {
      setPhase("error");
      setError("You must be signed in before creating a Project.");
      return;
    }
    setPhase("creating");
    setError(null);

    try {
      const jobResult = await createJob({});
      if (!jobResult.job) {
        throw new Error(jobResult.error ?? "Failed to create job");
      }

      const jobId = jobResult.job.id;
      setPhase("provisioning");

      const startedAt = Date.now();
      let openclawId = "";

      while (Date.now() - startedAt < 8 * 60 * 1000) {
        await new Promise((r) => setTimeout(r, 4000));
        const refreshResult = await refreshJob({ jobId });
        if (refreshResult.error) {
          throw new Error(refreshResult.error);
        }
        const job = refreshResult.job;
        if (!job) continue;

        if (job.status === "failed") {
          throw new Error(job.error ?? "Provisioning failed");
        }

        if (job.status === "succeeded" && job.openclaw) {
          openclawId = job.openclaw.openClawId;
          break;
        }
      }

      if (!openclawId) throw new Error("Provisioning timed out");

      setPhase("configuring");

      const aiResult = await configureAiProvider({ instanceId: openclawId, provider, apiKey, model });
      if (!aiResult.ok) throw new Error(aiResult.error ?? "AI provider configuration failed");

      if (channel === "telegram" && telegramToken) {
        const telegramResult = await configureTelegram({
          instanceId: openclawId,
          botToken: telegramToken,
          dmPolicy: "open",
        });
        if (!telegramResult.ok) throw new Error(telegramResult.error ?? "Telegram configuration failed");
      } else if (channel === "whatsapp") {
        const pairResult = await startWhatsAppPairing({ instanceId: openclawId });
        if (!pairResult.ok) throw new Error(pairResult.error ?? "WhatsApp pairing failed");
        if (pairResult.qrDataUrl) setQrDataUrl(pairResult.qrDataUrl);
      }

      setPhase("done");
      setTimeout(() => router.push("/"), 2000);
    } catch (err: unknown) {
      setPhase("error");
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const isDeploying = phase !== "idle" && phase !== "done" && phase !== "error";

  return (
    <div style={{ maxWidth: 480, margin: "0 auto", width: "100%", display: "flex", flexDirection: "column", gap: 24 }}>

      <div>
        <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 6 }}>Configure your assistant</h2>
        <p style={{ color: "#888", fontSize: 14 }}>
          {PROVIDER_LABELS[provider] ?? provider} · {channel === "telegram" ? "Telegram" : channel === "whatsapp" ? "WhatsApp" : "Discord"} · {session?.user?.email}
        </p>
      </div>

      {/* API Key */}
      <div>
        <label style={{ display: "block", fontSize: 13, color: "#888", marginBottom: 6 }}>
          {PROVIDER_LABELS[provider] ?? provider} API Key
        </label>
        <input
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder={provider === "anthropic" ? "sk-ant-..." : "sk-..."}
          disabled={isDeploying}
          style={{
            width: "100%", padding: "10px 14px",
            background: "#1a1a1a", border: "1px solid #2a2a2a",
            borderRadius: 8, color: "#f0f0f0", fontSize: 14, outline: "none",
            boxSizing: "border-box"
          }}
        />
      </div>

      {/* Telegram token */}
      {channel === "telegram" && (
        <div>
          <label style={{ display: "block", fontSize: 13, color: "#888", marginBottom: 6 }}>
            Telegram Bot Token{" "}
            <span style={{ opacity: 0.5 }}>
              — create one via{" "}
              <a href="https://t.me/BotFather" target="_blank" rel="noreferrer" style={{ color: "#5b6af0" }}>
                @BotFather
              </a>
            </span>
          </label>
          <input
            type="password"
            value={telegramToken}
            onChange={(e) => setTelegramToken(e.target.value)}
            placeholder="1234567890:AAB..."
            disabled={isDeploying}
            style={{
              width: "100%", padding: "10px 14px",
              background: "#1a1a1a", border: "1px solid #2a2a2a",
              borderRadius: 8, color: "#f0f0f0", fontSize: 14, outline: "none",
              boxSizing: "border-box"
            }}
          />
        </div>
      )}

      {channel === "whatsapp" && (
        <div style={{
          padding: 14, background: "rgba(91,106,240,0.08)",
          border: "1px solid rgba(91,106,240,0.2)", borderRadius: 8, fontSize: 14,
          color: "#888"
        }}>
          A QR code will appear after deployment. Scan it with WhatsApp to link your account.
        </div>
      )}

      {/* Progress */}
      {phase !== "idle" && (
        <div style={{
          padding: 14,
          background: phase === "error" ? "rgba(157,31,47,0.1)" : "rgba(91,106,240,0.08)",
          border: `1px solid ${phase === "error" ? "rgba(157,31,47,0.3)" : "rgba(91,106,240,0.2)"}`,
          borderRadius: 8, fontSize: 14,
          color: phase === "error" ? "#f87171" : "#f0f0f0"
        }}>
          {isDeploying && (
            <span style={{ marginRight: 8, display: "inline-block", animation: "spin 1s linear infinite" }}>⟳</span>
          )}
          {PHASE_LABELS[phase]}
          {phase === "error" && error && (
            <div style={{ marginTop: 6, fontSize: 13 }}>{error}</div>
          )}
        </div>
      )}

      {/* WhatsApp QR */}
      {qrDataUrl && (
        <div style={{ textAlign: "center" }}>
          <p style={{ fontSize: 14, color: "#888", marginBottom: 12 }}>
            Scan with WhatsApp to link your account:
          </p>
          <img
            src={qrDataUrl}
            alt="WhatsApp QR"
            style={{ width: 220, height: 220, background: "#fff", padding: 10, borderRadius: 12 }}
          />
        </div>
      )}

      <div style={{ display: "flex", gap: 10 }}>
        <button
          type="button"
          onClick={onBack}
          disabled={isDeploying}
          style={{
            padding: "12px 20px", background: "#1a1a1a",
            color: "#f0f0f0", border: "1px solid #2a2a2a",
            borderRadius: 8, fontSize: 15, fontWeight: 600,
            cursor: isDeploying ? "not-allowed" : "pointer", opacity: isDeploying ? 0.5 : 1
          }}
        >
          ← Back
        </button>
        <button
          type="button"
          onClick={() => void deploy()}
          disabled={isDeploying || phase === "done" || !canDeploy}
          style={{
            flex: 1,
            padding: "12px 28px",
            background: phase === "done" ? "#1e7f5c" : (isDeploying || !canDeploy) ? "#2a2a2a" : "#5b6af0",
            color: (isDeploying || !canDeploy) ? "#888" : "#fff",
            border: "none", borderRadius: 8, fontSize: 15, fontWeight: 700,
            cursor: (isDeploying || phase === "done" || !canDeploy) ? "not-allowed" : "pointer",
            transition: "all 0.15s"
          }}
        >
          {phase === "done" ? "✓ Deployed!" : isDeploying ? "Deploying…" : "Deploy my assistant"}
        </button>
      </div>
    </div>
  );
}
