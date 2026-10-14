"use client";

import { useEffect, useState } from "react";
import { useAction, useMutation } from "convex/react";
import { CheckCircle2, Cpu, CreditCard, KeyRound, LoaderCircle, Pencil, Trash2 } from "lucide-react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";

const DEFAULT_SUBSCRIPTION_PROVIDER = "openai";

import type {
  AiConfigState,
  InstanceRecord,
} from "@/src/components/instance-workspace.types";
import {
  defaultApiKeyForProvider,
  defaultBaseUrlForProvider,
  labelForProvider,
  qualifyModelForProvider,
} from "@/src/components/instance-workspace.utils";
import { useAuthenticatedInstances } from "@/src/hooks/use-authenticated-instances";
import { useOptionalPlugin } from "@/src/components/optional-plugins-provider";
import { useProviderAuth } from "@/src/hooks/use-provider-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type Props = { resolvedInstanceId: string };

type ProviderEntry = {
  kind: "subscription" | "apikey";
  provider: string;
  model: string;
  baseUrl?: string;
  inUse: boolean;
  updatedAt: string;
};

function providerKey(entry: Pick<ProviderEntry, "provider" | "kind">): string {
  return `${entry.provider}:${entry.kind}`;
}

export function ProvidersPageContent({ resolvedInstanceId }: Props) {
  // The ChatGPT subscription runs on the Codex plugin (OPENCLAW_OPTIONAL_PLUGINS).
  const codexAvailable = useOptionalPlugin("codex");
  const xiaomiAvailable = useOptionalPlugin("xiaomi");
  const [aiProvider, setAiProvider] = useState("");
  const [aiApiKey, setAiApiKey] = useState("");
  const [aiModel, setAiModel] = useState("");
  const [aiBaseUrl, setAiBaseUrl] = useState("");
  const [editingProvider, setEditingProvider] = useState<string | null>(null);
  const [showAddPanel, setShowAddPanel] = useState(false);
  const [addType, setAddType] = useState<"subscription" | "subscription-edit" | "apikey" | null>(null);
  const [aiConfig, setAiConfig] = useState<AiConfigState>({});
  const [activatingKey, setActivatingKey] = useState<string | null>(null);
  const [activateError, setActivateError] = useState<string | null>(null);
  const [editingSubscriptionProvider, setEditingSubscriptionProvider] = useState<string | null>(null);
  const [subscriptionModelInput, setSubscriptionModelInput] = useState("");

  const instances = useAuthenticatedInstances<InstanceRecord>();
  const configureAiProvider = useAction(
    api.project_provider_operations.configureAiProvider,
  );
  const removeProvider = useMutation(api.instances.removeProvider);
  const startAuthAction = useAction(api.auth_node.startAuth);
  const getAuthJobAction = useAction(api.auth_node.getAuthJob);
  const cancelAuthAction = useAction(api.auth_node.cancelAuth);
  const sendAuthInputAction = useAction(api.auth_node.sendAuthInput);
  const activateSubscriptionProvider = useAction(api.auth_node.activateSubscriptionProvider);
  const activateAuthOrderProvider = useAction(api.auth_node.activateAuthOrderProvider);
  const updateSubscriptionModel = useAction(api.auth_node.updateSubscriptionModel);

  const instance = instances?.find(
    (entry) =>
      entry.openclawId === resolvedInstanceId || entry.jobId === resolvedInstanceId,
  );
  const runtimeInstanceId = instance?.openclawId;
  const {
    job: authJob,
    authInput,
    setAuthInput,
    authCancelling,
    authSubmittingRedirect,
    authHasStarted,
    authIsStarting,
    authCanAcceptRedirectInput,
    authInputValidationError,
    authIsVerifyingRedirect,
    authSucceeded,
    authRestartRecovered,
    authBrowserUrl,
    authCanSubmit,
    startAuth,
    sendAuthInput,
    cancelAuth,
    resetAuthFlow,
  } = useProviderAuth(runtimeInstanceId, {
    startAuth: startAuthAction,
    getAuthJob: getAuthJobAction,
    sendAuthInput: sendAuthInputAction,
    cancelAuth: cancelAuthAction,
  });
  const isEditMode = editingProvider === aiProvider && !!editingProvider;
  const canSaveAiConfig =
    !!instance?.openclawId &&
    aiProvider.trim().length > 0 &&
    (isEditMode || aiApiKey.trim().length > 0) &&
    aiModel.trim().length > 0 &&
    aiConfig.status !== "saving";

  useEffect(() => {
    if (!aiProvider || aiModel) {
      return;
    }
    setAiBaseUrl(defaultBaseUrlForProvider(aiProvider));
  }, [aiProvider]);

  function closePanel(): void {
    setShowAddPanel(false);
    setAddType(null);
    setEditingProvider(null);
    setAiProvider("");
    setAiModel("");
    setAiBaseUrl("");
    setAiApiKey("");
    setAiConfig({});
    setEditingSubscriptionProvider(null);
    setSubscriptionModelInput("");
  }

  async function handleSaveAiConfig(): Promise<void> {
    if (!instance?.openclawId) {
      setAiConfig({ status: "error", error: "Project not connected yet" });
      return;
    }
    if (!aiProvider || !aiModel.trim() || (!isEditMode && !aiApiKey.trim())) {
      setAiConfig({
        status: "error",
        error: isEditMode
          ? "Model is required"
          : "Provider, API key and model are required",
      });
      return;
    }

    setAiConfig({ status: "saving" });
    try {
      const qualifiedModel = qualifyModelForProvider(aiProvider, aiModel);
      const result = await configureAiProvider({
        instanceId: instance.openclawId,
        provider: aiProvider,
        ...(aiApiKey.trim() ? { apiKey: aiApiKey.trim() } : {}),
        model: qualifiedModel,
        ...(aiBaseUrl.trim() ? { baseUrl: aiBaseUrl.trim() } : {}),
      });
      if (!result.ok) {
        setAiConfig({ status: "error", output: result.output, error: result.error ?? "Failed to save AI config" });
        return;
      }
      setAiConfig({
        status: "saved",
        output: result.output || `${labelForProvider(aiProvider)} configured.`,
        provider: aiProvider,
        model: qualifiedModel,
      });
      setAiApiKey("");
      setEditingProvider(null);
    } catch (error: unknown) {
      setAiConfig({
        status: "error",
        error:
          error instanceof Error ? error.message : "Failed to save AI config",
      });
    }
  }

  function handleActivateFromList(provider: string, model: string, baseUrl?: string): void {
    setAiProvider(provider);
    setAiModel(model);
    setAiBaseUrl(baseUrl ?? defaultBaseUrlForProvider(provider));
    setAiApiKey("");
    setEditingProvider(provider);
    setAiConfig({});
  }

  async function handleRemoveProvider(entry: ProviderEntry): Promise<void> {
    if (!instance?._id) return;
    await removeProvider({
      instanceId: instance._id as Id<"instances">,
      kind: entry.kind,
      provider: entry.provider,
    });
  }

  // Reactivates an already-configured Provider in one click: no OAuth
  // re-exchange for a subscription, no api key re-entry for an apikey
  // Provider — both paths just resubmit what's already stored. See
  // GLOSSARY.md's Provider entry.
  //
  // When another Provider with the same underlying provider id is currently
  // in use (an "openai" apikey vs an "openai" subscription, say), switching
  // model.primary alone is a no-op — both entries resolve to that same
  // value. auth.order.<provider> is what actually picks between them, so
  // that case goes through activateAuthOrderProvider instead (see #289).
  async function handleActivateProvider(entry: ProviderEntry): Promise<void> {
    if (!instance?.openclawId) return;
    setActivateError(null);
    setActivatingKey(providerKey(entry));
    try {
      if (isSwitchingSameProviderAuth(entry)) {
        const result = await activateAuthOrderProvider({
          instanceId: instance.openclawId,
          provider: entry.provider,
          kind: entry.kind,
          model: entry.model,
        });
        if (result.error) {
          setActivateError(result.error);
        }
      } else if (entry.kind === "subscription") {
        const result = await activateSubscriptionProvider({
          instanceId: instance.openclawId,
          provider: entry.provider,
          model: entry.model,
        });
        if (result.error) {
          setActivateError(result.error);
        }
      } else {
        const result = await configureAiProvider({
          instanceId: instance.openclawId,
          provider: entry.provider,
          model: entry.model,
          ...(entry.baseUrl ? { baseUrl: entry.baseUrl } : {}),
        });
        if (result.error) {
          setActivateError(result.error);
        }
      }
    } catch (error: unknown) {
      setActivateError(error instanceof Error ? error.message : "Failed to activate provider");
    } finally {
      setActivatingKey(null);
    }
  }

  // Changes a linked subscription's model in place — the subscription-side
  // equivalent of editing an apikey Provider's model via handleSaveAiConfig.
  // Like that path, saving also activates the Provider (see
  // updateSubscriptionModel's own comment in auth_node.ts) — so this reuses
  // the same activatingKey/activateError state as the row's Activate radio
  // rather than a parallel status object.
  async function handleUpdateSubscriptionModel(): Promise<void> {
    if (!instance?.openclawId || !editingSubscriptionProvider) return;
    const model = subscriptionModelInput.trim();
    if (!model) {
      setActivateError("Model is required");
      return;
    }
    const key = providerKey({ provider: editingSubscriptionProvider, kind: "subscription" });
    setActivateError(null);
    setActivatingKey(key);
    try {
      const result = await updateSubscriptionModel({
        instanceId: instance.openclawId,
        provider: editingSubscriptionProvider,
        model,
      });
      if (result.error) {
        setActivateError(result.error);
        return;
      }
      closePanel();
    } catch (error: unknown) {
      setActivateError(error instanceof Error ? error.message : "Failed to update model");
    } finally {
      setActivatingKey(null);
    }
  }

  if (!instance) {
    return null;
  }

  const providers: ProviderEntry[] = instance.providers ?? [];
  const subscriptionEntry = providers.find((entry) => entry.kind === "subscription");
  const managedAuthLinked = Boolean(subscriptionEntry);
  const managedAuthProviderLabel =
    subscriptionEntry?.provider === DEFAULT_SUBSCRIPTION_PROVIDER
      ? "OpenAI"
      : subscriptionEntry?.provider;
  // Two Providers can share the same underlying provider id (an "openai"
  // apikey and an "openai" subscription configured at once) — switching
  // between those two specifically needs OpenClaw's auth.order, not just
  // agents.defaults.model.primary (see #289 and activateAuthOrderProvider
  // above). This flag routes handleActivateProvider to that path instead of
  // gating the button.
  function isSwitchingSameProviderAuth(entry: ProviderEntry): boolean {
    return providers.some(
      (other) => other.provider === entry.provider && other.kind !== entry.kind && other.inUse,
    );
  }

  return (
    <section className="grid gap-6">
      {/* Page header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-[var(--dashboard-ink)]">Provider Management</h2>
          <p className="mt-1 text-sm text-[var(--dashboard-ink-muted)]">
            Manage your subscriptions and API keys.
          </p>
        </div>
        <Button
          type="button"
          onClick={() => {
            if (showAddPanel) { closePanel(); }
            else { setShowAddPanel(true); setAiConfig({}); }
          }}
          className="h-10 shrink-0 rounded-xl bg-[var(--dashboard-primary)] px-4 text-sm text-[var(--dashboard-on-primary)] hover:bg-[var(--dashboard-primary-container)]"
        >
          + Add provider
        </Button>
      </div>

      {activateError ? <p className="text-sm text-[#8f3030]">{activateError}</p> : null}

      {/* Providers table */}
      <div className="overflow-hidden rounded-xl border border-[rgba(0,38,27,0.1)]">
        {/* Table header */}
        <div className="grid grid-cols-[1.3fr_1fr_150px_130px_96px] border-b border-[rgba(0,38,27,0.08)] bg-[rgba(243,244,244,0.6)] px-5 py-2.5">
          <span className="text-xs font-semibold uppercase tracking-wide text-[var(--dashboard-ink-muted)]">Provider</span>
          <span className="text-xs font-semibold uppercase tracking-wide text-[var(--dashboard-ink-muted)]">Model</span>
          <span className="text-xs font-semibold uppercase tracking-wide text-[var(--dashboard-ink-muted)]">Type</span>
          <span className="text-xs font-semibold uppercase tracking-wide text-[var(--dashboard-ink-muted)]">Status</span>
          <span className="text-right text-xs font-semibold uppercase tracking-wide text-[var(--dashboard-ink-muted)]">Actions</span>
        </div>

        {providers.map((entry, idx) => {
          const key = providerKey(entry);
          const isSubscription = entry.kind === "subscription";
          const isSwitchingAuth = !entry.inUse && isSwitchingSameProviderAuth(entry);
          return (
            <div
              key={key}
              className={`grid grid-cols-[1.3fr_1fr_150px_130px_96px] items-center px-5 py-4 ${idx < providers.length - 1 ? "border-b border-[rgba(0,38,27,0.06)]" : ""}`}
            >
              <div className="flex items-center gap-3">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-[rgba(220,230,224,0.5)]">
                  {isSubscription ? (
                    <CreditCard className="size-4 text-[var(--dashboard-primary)]" />
                  ) : (
                    <Cpu className="size-4 text-[var(--dashboard-primary)]" />
                  )}
                </div>
                <div className="text-sm font-medium text-[var(--dashboard-ink)]">
                  {isSubscription
                    ? `${entry.provider === DEFAULT_SUBSCRIPTION_PROVIDER ? "OpenAI" : entry.provider} Subscription`
                    : labelForProvider(entry.provider)}
                </div>
              </div>
              <div>
                <code className="inline-block rounded-md border border-[var(--dashboard-outline-strong)] bg-[var(--dashboard-surface-container)] px-2 py-1 font-mono text-xs text-[var(--dashboard-ink)]">
                  {entry.model}
                </code>
              </div>
              <div>
                <span className="inline-flex items-center rounded-md border border-[rgba(0,38,27,0.12)] bg-white px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wide text-[var(--dashboard-ink-muted)]">
                  {isSubscription ? "Subscription" : "Direct API key"}
                </span>
              </div>
              <div className="flex items-center">
                <label
                  title={
                    !entry.inUse && isSwitchingAuth
                      ? "Switches to this provider's other configured auth method (API key vs. subscription)."
                      : undefined
                  }
                  className={`inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wide ${
                    entry.inUse ? "text-[var(--dashboard-primary)]" : "text-[var(--dashboard-ink-muted)]"
                  } ${activatingKey === key ? "cursor-wait" : "cursor-pointer"}`}
                >
                  <input
                    type="radio"
                    name={`active-provider-${instance?._id ?? "unknown"}`}
                    checked={entry.inUse}
                    disabled={activatingKey === key}
                    onChange={() => {
                      if (!entry.inUse) void handleActivateProvider(entry);
                    }}
                    aria-label={`Activate ${labelForProvider(entry.provider)}`}
                    className="size-4 accent-[var(--dashboard-primary)] disabled:cursor-wait"
                  />
                  {activatingKey === key ? (
                    <>
                      <LoaderCircle className="size-3 animate-spin" />
                      Activating…
                    </>
                  ) : entry.inUse ? (
                    "Active"
                  ) : (
                    "Inactive"
                  )}
                </label>
              </div>
              <div className="flex items-center justify-end gap-1">
                <button
                  type="button"
                  aria-label={isSubscription ? `Edit ${labelForProvider(entry.provider)} model` : `Edit ${labelForProvider(entry.provider)}`}
                  onClick={() => {
                    if (isSubscription) {
                      setEditingSubscriptionProvider(entry.provider);
                      setSubscriptionModelInput(entry.model);
                      setActivateError(null);
                      setShowAddPanel(true);
                      setAddType("subscription-edit");
                    } else {
                      handleActivateFromList(entry.provider, entry.model, entry.baseUrl);
                      setShowAddPanel(true);
                      setAddType("apikey");
                    }
                  }}
                  className="flex size-8 items-center justify-center rounded-lg text-[var(--dashboard-ink-muted)] hover:bg-[rgba(0,38,27,0.06)] hover:text-[var(--dashboard-primary)]"
                >
                  <Pencil className="size-4" />
                </button>
                <button
                  type="button"
                  aria-label={`Remove ${labelForProvider(entry.provider)}`}
                  title={entry.inUse ? "Activate another provider before removing this one." : undefined}
                  disabled={entry.inUse}
                  onClick={() => void handleRemoveProvider(entry)}
                  className="flex size-8 items-center justify-center rounded-lg text-[var(--dashboard-ink-muted)] hover:bg-[rgba(0,38,27,0.06)] hover:text-[#8f3030] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-[var(--dashboard-ink-muted)]"
                >
                  <Trash2 className="size-4" />
                </button>
              </div>
            </div>
          );
        })}

        {/* Empty state */}
        {providers.length === 0 ? (
          <div className="py-16 text-center text-sm text-[var(--dashboard-ink-muted)]">
            No providers configured. Click &ldquo;Add provider&rdquo; to get started.
          </div>
        ) : null}
      </div>

      {/* Add / edit panel */}
      {showAddPanel ? (
        <div className="overflow-hidden rounded-xl border border-[rgba(0,38,27,0.1)] bg-white">
          {/* Type selector */}
          {!addType ? (
            <div className="p-6">
              <h3 className="mb-4 text-base font-semibold text-[var(--dashboard-ink)]">Choose provider type</h3>
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setAddType("subscription")}
                  disabled={!codexAvailable}
                  className="flex flex-col items-start gap-2 rounded-xl border border-[rgba(0,38,27,0.1)] bg-[rgba(243,244,244,0.5)] p-4 text-left hover:border-[var(--dashboard-primary)] hover:bg-[rgba(220,230,224,0.3)] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-[rgba(0,38,27,0.1)] disabled:hover:bg-[rgba(243,244,244,0.5)]"
                >
                  <CreditCard className="size-5 text-[var(--dashboard-primary)]" />
                  <span className="text-sm font-medium text-[var(--dashboard-ink)]">Subscription</span>
                  <span className="text-xs text-[var(--dashboard-ink-muted)]">
                    {codexAvailable
                      ? "Delegate billing and access via OpenAI"
                      : 'Not available on this Instance (add "codex" to OPENCLAW_OPTIONAL_PLUGINS)'}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => setAddType("apikey")}
                  className="flex flex-col items-start gap-2 rounded-xl border border-[rgba(0,38,27,0.1)] bg-[rgba(243,244,244,0.5)] p-4 text-left hover:border-[var(--dashboard-primary)] hover:bg-[rgba(220,230,224,0.3)]"
                >
                  <KeyRound className="size-5 text-[var(--dashboard-primary)]" />
                  <span className="text-sm font-medium text-[var(--dashboard-ink)]">Direct API key</span>
                  <span className="text-xs text-[var(--dashboard-ink-muted)]">Use your own API key (BYOK)</span>
                </button>
              </div>
              <div className="mt-4 flex justify-end">
                <Button
                  type="button"
                  variant="outline"
                  onClick={closePanel}
                  className="h-9 rounded-xl border-[rgba(0,38,27,0.12)] px-4 text-sm"
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : null}

          {/* Subscription model edit — changes which model a linked
              subscription uses without repeating the OAuth exchange, the
              subscription-side equivalent of the API key form's edit mode
              below. */}
          {addType === "subscription-edit" ? (
            <div className="p-6">
              <div className="mb-4 flex items-center justify-between">
                <h3 className="text-base font-semibold text-[var(--dashboard-ink)]">
                  Edit — {editingSubscriptionProvider === DEFAULT_SUBSCRIPTION_PROVIDER ? "OpenAI" : editingSubscriptionProvider} Subscription
                </h3>
                <button
                  type="button"
                  onClick={closePanel}
                  className="text-xs text-[var(--dashboard-ink-muted)] underline"
                >
                  ← Back
                </button>
              </div>
              <div className="grid gap-5">
                <div className="grid gap-2">
                  <Label htmlFor="subscription-model">Model</Label>
                  <Input
                    id="subscription-model"
                    value={subscriptionModelInput}
                    onChange={(e) => setSubscriptionModelInput(e.target.value)}
                    placeholder="openai/gpt-5.5"
                    className="h-12 rounded-xl border-[rgba(0,38,27,0.1)] bg-white px-4"
                  />
                </div>
                <div className="flex gap-3">
                  <Button
                    type="button"
                    disabled={
                      !subscriptionModelInput.trim() ||
                      activatingKey === providerKey({ provider: editingSubscriptionProvider ?? "", kind: "subscription" })
                    }
                    onClick={() => void handleUpdateSubscriptionModel()}
                    className="h-11 rounded-xl bg-[var(--dashboard-primary)] px-5 text-[var(--dashboard-on-primary)] hover:bg-[var(--dashboard-primary-container)]"
                  >
                    {activatingKey === providerKey({ provider: editingSubscriptionProvider ?? "", kind: "subscription" })
                      ? "Saving…"
                      : "Update"}
                  </Button>
                  <Button type="button" variant="outline" onClick={closePanel} className="h-11 rounded-xl border-[rgba(0,38,27,0.12)] px-5">
                    Cancel
                  </Button>
                </div>
              </div>
            </div>
          ) : null}

          {/* Subscription form */}
          {addType === "subscription" && codexAvailable ? (
            <div className="p-6">
              <div className="mb-4 flex items-center justify-between">
                <h3 className="text-base font-semibold text-[var(--dashboard-ink)]">Link OpenAI Subscription</h3>
                <button
                  type="button"
                  onClick={() => setAddType(null)}
                  className="text-xs text-[var(--dashboard-ink-muted)] underline"
                >
                  ← Back
                </button>
              </div>
              <div className="grid gap-5">
                {!authHasStarted ? (
                  <Button
                    type="button"
                    disabled={authIsStarting}
                    onClick={() => void startAuth(DEFAULT_SUBSCRIPTION_PROVIDER)}
                    className="h-11 w-fit rounded-xl bg-[var(--dashboard-primary)] px-5 text-[var(--dashboard-on-primary)] hover:bg-[var(--dashboard-primary-container)]"
                  >
                    {managedAuthLinked ? "Relink OpenAI Subscription" : "Link OpenAI Subscription"}
                  </Button>
                ) : null}
                {authJob.error ? <p className="text-sm text-[#8f3030]">{authJob.error}</p> : null}
                {authSucceeded ? (
                  <div className="grid gap-4">
                    <div className="rounded-[1.25rem] border border-[rgba(35,105,73,0.18)] bg-[rgba(235,246,240,0.95)] p-5">
                      <div className="flex items-start gap-3">
                        <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[#236949] text-white">
                          <CheckCircle2 className="size-5" />
                        </div>
                        <div className="grid gap-2">
                          <h4 className="text-base font-semibold text-[var(--dashboard-ink)]">Subscription linked successfully</h4>
                          <p className="text-sm leading-6 text-[var(--dashboard-ink-muted)]">
                            {managedAuthProviderLabel ?? "OpenAI"} is now linked to this Project.
                          </p>
                        </div>
                      </div>
                    </div>
                    <Button type="button" variant="outline" className="h-11 w-fit rounded-xl border-[rgba(0,38,27,0.12)] bg-white px-5 text-[var(--dashboard-primary)]" onClick={() => { resetAuthFlow(); closePanel(); }}>
                      Close
                    </Button>
                  </div>
                ) : null}
                {authHasStarted && !authSucceeded ? (
                  <div className="grid gap-4">
                    <div className="grid gap-3 rounded-[1.25rem] border border-[rgba(0,38,27,0.08)] bg-[rgba(243,244,244,0.75)] p-5">
                      <div className="flex items-start gap-3">
                        <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-[var(--dashboard-primary)] text-sm font-semibold text-[var(--dashboard-on-primary)]">1</div>
                        <div className="grid gap-2">
                          <h4 className="text-base font-semibold text-[var(--dashboard-ink)]">Get authorization URL</h4>
                          <p className="text-sm leading-6 text-[var(--dashboard-ink-muted)]">
                            {authRestartRecovered
                              ? "The gateway restarted before the flow completed. Restart from this page."
                              : "Log in with your OpenAI account, then keep this page open."}
                          </p>
                        </div>
                      </div>
                      {authRestartRecovered ? (
                        <Button type="button" className="h-11 w-fit rounded-xl bg-[var(--dashboard-primary)] px-5 text-[var(--dashboard-on-primary)]" onClick={() => void startAuth(DEFAULT_SUBSCRIPTION_PROVIDER)}>
                          Restart flow
                        </Button>
                      ) : null}
                      {authIsStarting && !authBrowserUrl ? (
                        <div className="flex items-center gap-3 rounded-xl bg-white px-4 py-4 text-sm text-[var(--dashboard-ink-muted)] shadow-[inset_0_0_0_1px_rgba(0,38,27,0.06)]">
                          <LoaderCircle className="size-5 animate-spin text-[var(--dashboard-primary)]" />
                          <span>Getting your authorization URL…</span>
                        </div>
                      ) : null}
                      {authBrowserUrl ? (
                        <div className="grid gap-3">
                          <a href={authBrowserUrl} target="_blank" rel="noreferrer" className="block w-full rounded-xl border border-[rgba(0,38,27,0.08)] bg-white px-4 py-3 text-sm text-[var(--dashboard-primary)] underline underline-offset-4 [overflow-wrap:anywhere]">{authBrowserUrl}</a>
                          <Button type="button" className="h-11 w-fit rounded-xl bg-[rgba(220,230,224,0.66)] px-5 text-[var(--dashboard-primary)]" onClick={() => window.open(authBrowserUrl, "_blank", "noopener,noreferrer")}>Open URL</Button>
                        </div>
                      ) : null}
                    </div>
                    <div className="grid gap-3 rounded-[1.25rem] border border-[rgba(0,38,27,0.08)] bg-[rgba(243,244,244,0.75)] p-5">
                      <div className="flex items-start gap-3">
                        <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-[var(--dashboard-primary)] text-sm font-semibold text-[var(--dashboard-on-primary)]">2</div>
                        <div className="grid gap-2">
                          <h4 className="text-base font-semibold text-[var(--dashboard-ink)]">Copy redirect URL</h4>
                          <p className="text-sm leading-6 text-[var(--dashboard-ink-muted)]">Once OpenAI finishes, copy the final redirect URL from your browser and paste it here.</p>
                        </div>
                      </div>
                      <div className="grid gap-2">
                        <Label htmlFor="subscription-auth-input">Redirect URL</Label>
                        <Input id="subscription-auth-input" value={authInput} onChange={(e) => setAuthInput(e.target.value)} placeholder="Paste the final redirect URL" disabled={!authCanAcceptRedirectInput || authRestartRecovered || authSubmittingRedirect} className="h-12 rounded-xl border-[rgba(0,38,27,0.1)] bg-white px-4" />
                        {authInputValidationError ? <p className="text-sm text-[#8f3030]">{authInputValidationError}</p> : null}
                      </div>
                      {authIsVerifyingRedirect ? (
                        <div className="flex items-center gap-3 rounded-xl bg-white px-4 py-4 text-sm text-[var(--dashboard-ink-muted)] shadow-[inset_0_0_0_1px_rgba(0,38,27,0.06)]">
                          <LoaderCircle className="size-5 animate-spin text-[var(--dashboard-primary)]" />
                          <span>Verifying your authorization…</span>
                        </div>
                      ) : null}
                      <Button type="button" disabled={!authCanSubmit} className="h-11 w-fit rounded-xl bg-[rgba(220,230,224,0.66)] px-5 text-[var(--dashboard-primary)] disabled:opacity-50" onClick={() => void sendAuthInput(false)}>
                        {authSubmittingRedirect ? "Verifying…" : "Submit URL"}
                      </Button>
                    </div>
                    <Button type="button" variant="outline" className="h-11 w-fit rounded-xl border-[rgba(0,38,27,0.12)] bg-white px-5 text-[var(--dashboard-primary)]" disabled={authCancelling} onClick={() => void cancelAuth()}>
                      {authCancelling ? "Cancelling…" : "Cancel"}
                    </Button>
                    {authJob.logs && authJob.logs.length > 0 ? (
                      <div className="grid gap-2 rounded-[1.25rem] border border-[rgba(0,38,27,0.08)] bg-[rgba(243,244,244,0.75)] p-5">
                        <h4 className="text-base font-semibold text-[var(--dashboard-ink)]">Authorization logs</h4>
                        <pre className="m-0 max-h-72 overflow-auto whitespace-pre-wrap rounded-[1rem] bg-white p-4 text-sm leading-6 text-[var(--dashboard-ink-muted)] shadow-[inset_0_0_0_1px_rgba(0,38,27,0.06)]">{authJob.logs.join("\n")}</pre>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}

          {/* API key form */}
          {addType === "apikey" ? (
            <div className="p-6">
              <div className="mb-4 flex items-center justify-between">
                <h3 className="text-base font-semibold text-[var(--dashboard-ink)]">
                  {isEditMode ? `Edit — ${labelForProvider(aiProvider)}` : "Add API key"}
                </h3>
                <button
                  type="button"
                  onClick={() => {
                    if (editingProvider !== null) {
                      closePanel();
                    } else {
                      setAddType(null);
                      setAiProvider("");
                      setAiModel("");
                      setAiBaseUrl("");
                      setAiApiKey("");
                      setAiConfig({});
                    }
                  }}
                  className="text-xs text-[var(--dashboard-ink-muted)] underline"
                >
                  ← Back
                </button>
              </div>
              <div className="grid gap-5">
                <div className="grid gap-2">
                  <Label htmlFor="ai-provider">Provider</Label>
                  <Select
                    value={aiProvider}
                    onValueChange={(raw) => { const v = raw ?? ""; setAiProvider(v); setAiModel(""); setAiBaseUrl(defaultBaseUrlForProvider(v)); setAiApiKey(defaultApiKeyForProvider(v)); setEditingProvider(null); }}
                    disabled={isEditMode}
                  >
                    <SelectTrigger id="ai-provider" className="h-12 w-full rounded-xl border-[rgba(0,38,27,0.1)] bg-white px-4 text-sm disabled:cursor-not-allowed disabled:opacity-60">
                      <SelectValue placeholder="Select provider…" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="openai">OpenAI</SelectItem>
                      <SelectItem value="anthropic">Anthropic</SelectItem>
                      {xiaomiAvailable || aiProvider === "xiaomi" ? (
                        <SelectItem value="xiaomi">Xiaomi</SelectItem>
                      ) : null}
                      <SelectItem value="openrouter">OpenRouter</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="ai-api-key">
                    API Key
                    {isEditMode && <span className="ml-2 text-xs text-muted-foreground">(kept — not editable in edit mode)</span>}
                  </Label>
                  <Input id="ai-api-key" type="password" value={isEditMode ? "" : aiApiKey} onChange={(e) => setAiApiKey(e.target.value)} placeholder={isEditMode ? "••••••••" : "sk-..."} disabled={isEditMode} className="h-12 rounded-xl border-[rgba(0,38,27,0.1)] bg-white px-4 disabled:cursor-not-allowed disabled:opacity-60" />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="ai-model">Model</Label>
                  <Input id="ai-model" value={aiModel} onChange={(e) => setAiModel(e.target.value)} placeholder="gpt-4o, mimo-v2.5… (provider prefix added automatically)" className="h-12 rounded-xl border-[rgba(0,38,27,0.1)] bg-white px-4" />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="ai-base-url">Base URL <span className="text-xs text-muted-foreground">(optional)</span></Label>
                  <Input id="ai-base-url" value={aiBaseUrl} onChange={(e) => setAiBaseUrl(e.target.value)} placeholder="https://api.example.com/v1" className="h-12 rounded-xl border-[rgba(0,38,27,0.1)] bg-white px-4" />
                </div>
                {aiConfig.output ? <p className="text-sm text-[#236949]">{aiConfig.output}</p> : null}
                {aiConfig.error ? <p className="text-sm text-[#8f3030]">{aiConfig.error}</p> : null}
                <div className="flex gap-3">
                  <Button type="button" disabled={!canSaveAiConfig} onClick={() => void handleSaveAiConfig()} className="h-11 rounded-xl bg-[var(--dashboard-primary)] px-5 text-[var(--dashboard-on-primary)] hover:bg-[var(--dashboard-primary-container)]">
                    {aiConfig.status === "saving" ? "Saving…" : isEditMode ? "Update" : "Save"}
                  </Button>
                  <Button type="button" variant="outline" onClick={closePanel} className="h-11 rounded-xl border-[rgba(0,38,27,0.12)] px-5">
                    Cancel
                  </Button>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
