"use client";

import { useEffect, useState } from "react";
import { useAction, useMutation } from "convex/react";
import { CheckCircle2, Cpu, CreditCard, KeyRound, LoaderCircle, Pencil, Plus, Trash2 } from "lucide-react";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { StatusBadge } from "@/components/opengroow/status-badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const ROW_GRID = "grid grid-cols-[1.4fr_1.2fr_9rem_8rem_6rem] gap-4";

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
      <div className="flex items-center justify-end gap-4">
        <Button
          variant="glow"
          size="lg"
          type="button"
          onClick={() => {
            setShowAddPanel(true);
            setAiConfig({});
          }}
        >
          <Plus />
          Add provider
        </Button>
      </div>

      {activateError ? <p className="m-0 text-sm text-destructive">{activateError}</p> : null}

      <Card className="gap-0 py-0">
        <div className={`${ROW_GRID} border-b border-border px-6 py-4`}>
          {["Provider", "Model", "Type", "Status", "Actions"].map((label, index) => (
            <span
              key={label}
              className={`text-xs font-semibold tracking-wide text-muted-foreground uppercase ${index === 4 ? "text-right" : ""}`}
            >
              {label}
            </span>
          ))}
        </div>

        {providers.map((entry) => {
          const key = providerKey(entry);
          const isSubscription = entry.kind === "subscription";
          const isSwitchingAuth = !entry.inUse && isSwitchingSameProviderAuth(entry);
          const name = isSubscription
            ? `${entry.provider === DEFAULT_SUBSCRIPTION_PROVIDER ? "OpenAI" : entry.provider} Subscription`
            : labelForProvider(entry.provider);
          const activating = activatingKey === key;
          return (
            <div
              key={key}
              className={`${ROW_GRID} items-center border-b border-border px-6 py-4 last:border-b-0`}
            >
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-border bg-muted/60">
                  {isSubscription ? (
                    <CreditCard className="size-5 text-primary" />
                  ) : (
                    <Cpu className="size-5 text-primary" />
                  )}
                </div>
                <span className="truncate text-base font-medium text-foreground">{name}</span>
              </div>
              <div className="min-w-0">
                <Badge variant="tag" className="max-w-full font-mono text-xs">
                  <span className="truncate">{entry.model}</span>
                </Badge>
              </div>
              <div>
                <Badge variant="tag">
                  {isSubscription ? "Subscription" : "Direct API key"}
                </Badge>
              </div>
              <div>
                <label
                  title={
                    isSwitchingAuth
                      ? "Switches to this provider's other configured auth method (API key vs. subscription)."
                      : undefined
                  }
                  className={`inline-flex items-center gap-2 ${activating ? "cursor-wait" : "cursor-pointer"}`}
                >
                  <input
                    type="radio"
                    name={`active-provider-${instance?._id ?? "unknown"}`}
                    checked={entry.inUse}
                    disabled={activating}
                    onChange={() => {
                      if (!entry.inUse) void handleActivateProvider(entry);
                    }}
                    aria-label={`Activate ${labelForProvider(entry.provider)}`}
                    className="sr-only"
                  />
                  {activating ? (
                    <Badge variant="outline" size="xs" className="text-foreground">
                      <LoaderCircle className="animate-spin" />
                      Activating…
                    </Badge>
                  ) : (
                    <StatusBadge
                      tone={entry.inUse ? "active" : "neutral"}
                      label={entry.inUse ? "Active" : "Inactive"}
                    />
                  )}
                </label>
              </div>
              <div className="flex items-center justify-end gap-2">
                <Button
                  variant="outline"
                  size="icon-sm"
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
                >
                  <Pencil />
                </Button>
                <Button
                  variant="outline"
                  size="icon-sm"
                  type="button"
                  aria-label={`Remove ${labelForProvider(entry.provider)}`}
                  title={entry.inUse ? "Activate another provider before removing this one." : undefined}
                  disabled={entry.inUse}
                  onClick={() => void handleRemoveProvider(entry)}
                >
                  <Trash2 />
                </Button>
              </div>
            </div>
          );
        })}

        {providers.length === 0 ? (
          <div className="py-16 text-center text-sm text-muted-foreground">
            No providers configured. Click &ldquo;Add provider&rdquo; to get started.
          </div>
        ) : null}
      </Card>

      {/* Add / edit modal */}
      <Dialog
        open={showAddPanel}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) closePanel();
        }}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto p-0">
          {/* Type selector */}
          {!addType ? (
            <div className="p-6">
              <h3 className="mb-4 text-base font-semibold text-foreground">Choose provider type</h3>
              <div className="grid grid-cols-2 gap-3">
                <Button
                  variant="outline"
                  type="button"
                  className="h-auto flex-col items-start gap-2 p-4 text-left whitespace-normal"
                  onClick={() => setAddType("subscription")}
                  disabled={!codexAvailable}
                >
                  <CreditCard className="size-5 text-primary" />
                  <span className="text-sm font-medium text-foreground">Subscription</span>
                  <span className="text-xs text-muted-foreground">
                    {codexAvailable
                      ? "Delegate billing and access via OpenAI"
                      : 'Not available on this Instance (add "codex" to OPENCLAW_OPTIONAL_PLUGINS)'}
                  </span>
                </Button>
                <Button
                  variant="outline"
                  type="button"
                  className="h-auto flex-col items-start gap-2 p-4 text-left whitespace-normal"
                  onClick={() => setAddType("apikey")}
                >
                  <KeyRound className="size-5 text-primary" />
                  <span className="text-sm font-medium text-foreground">Direct API key</span>
                  <span className="text-xs text-muted-foreground">Use your own API key (BYOK)</span>
                </Button>
              </div>
              <div className="mt-4 flex justify-end">
                <Button size="lg"
                  type="button"
                  variant="outline"
                  onClick={closePanel}
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
                <h3 className="text-base font-semibold text-foreground">
                  Edit — {editingSubscriptionProvider === DEFAULT_SUBSCRIPTION_PROVIDER ? "OpenAI" : editingSubscriptionProvider} Subscription
                </h3>
                <Button
                  variant="link"
                  type="button"
                  onClick={closePanel}
                  className="h-auto p-0"
                >
                  ← Back
                </Button>
              </div>
              <div className="grid gap-5">
                <div className="grid gap-2">
                  <Label htmlFor="subscription-model">Model</Label>
                  <Input
                    id="subscription-model"
                    value={subscriptionModelInput}
                    onChange={(e) => setSubscriptionModelInput(e.target.value)}
                    placeholder="openai/gpt-5.5"
                    className="h-12 rounded-xl border-border bg-card px-4"
                  />
                </div>
                <div className="flex gap-3">
                  <Button size="lg"
                    type="button"
                    disabled={
                      !subscriptionModelInput.trim() ||
                      activatingKey === providerKey({ provider: editingSubscriptionProvider ?? "", kind: "subscription" })
                    }
                    onClick={() => void handleUpdateSubscriptionModel()}
                  >
                    {activatingKey === providerKey({ provider: editingSubscriptionProvider ?? "", kind: "subscription" })
                      ? "Saving…"
                      : "Update"}
                  </Button>
                  <Button size="lg" type="button" variant="outline" onClick={closePanel}>
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
                <h3 className="text-base font-semibold text-foreground">Link OpenAI Subscription</h3>
                <Button
                  variant="link"
                  type="button"
                  onClick={() => setAddType(null)}
                  className="h-auto p-0"
                >
                  ← Back
                </Button>
              </div>
              <div className="grid gap-5">
                {!authHasStarted ? (
                  <Button size="lg"
                    type="button"
                    disabled={authIsStarting}
                    onClick={() => void startAuth(DEFAULT_SUBSCRIPTION_PROVIDER)}
                    className="w-fit"
                  >
                    {managedAuthLinked ? "Relink OpenAI Subscription" : "Link OpenAI Subscription"}
                  </Button>
                ) : null}
                {authJob.error ? <p className="text-sm text-destructive">{authJob.error}</p> : null}
                {authSucceeded ? (
                  <div className="grid gap-4">
                    <div className="rounded-xl border border-border bg-muted p-5">
                      <div className="flex items-start gap-3">
                        <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-status-success text-primary-foreground">
                          <CheckCircle2 className="size-5" />
                        </div>
                        <div className="grid gap-2">
                          <h4 className="text-base font-semibold text-foreground">Subscription linked successfully</h4>
                          <p className="text-sm leading-6 text-muted-foreground">
                            {managedAuthProviderLabel ?? "OpenAI"} is now linked to this Project.
                          </p>
                        </div>
                      </div>
                    </div>
                    <Button size="lg" type="button" variant="outline" className="w-fit" onClick={() => { resetAuthFlow(); closePanel(); }}>
                      Close
                    </Button>
                  </div>
                ) : null}
                {authHasStarted && !authSucceeded ? (
                  <div className="grid gap-4">
                    <div className="grid gap-3 rounded-xl border border-border bg-muted p-5">
                      <div className="flex items-start gap-3">
                        <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">1</div>
                        <div className="grid gap-2">
                          <h4 className="text-base font-semibold text-foreground">Get authorization URL</h4>
                          <p className="text-sm leading-6 text-muted-foreground">
                            {authRestartRecovered
                              ? "The gateway restarted before the flow completed. Restart from this page."
                              : "Log in with your OpenAI account, then keep this page open."}
                          </p>
                        </div>
                      </div>
                      {authRestartRecovered ? (
                        <Button size="lg" type="button" className="w-fit" onClick={() => void startAuth(DEFAULT_SUBSCRIPTION_PROVIDER)}>
                          Restart flow
                        </Button>
                      ) : null}
                      {authIsStarting && !authBrowserUrl ? (
                        <div className="flex items-center gap-3 rounded-xl bg-card px-4 py-4 text-sm text-muted-foreground ring-1 ring-inset ring-border">
                          <LoaderCircle className="size-5 animate-spin text-primary" />
                          <span>Getting your authorization URL…</span>
                        </div>
                      ) : null}
                      {authBrowserUrl ? (
                        <div className="grid gap-3">
                          <a href={authBrowserUrl} target="_blank" rel="noreferrer" className="block w-full rounded-xl border border-border bg-card px-4 py-3 text-sm text-primary underline underline-offset-4 [overflow-wrap:anywhere]">{authBrowserUrl}</a>
                          <Button variant="secondary" size="lg" type="button" className="w-fit" onClick={() => window.open(authBrowserUrl, "_blank", "noopener,noreferrer")}>Open URL</Button>
                        </div>
                      ) : null}
                    </div>
                    <div className="grid gap-3 rounded-xl border border-border bg-muted p-5">
                      <div className="flex items-start gap-3">
                        <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">2</div>
                        <div className="grid gap-2">
                          <h4 className="text-base font-semibold text-foreground">Copy redirect URL</h4>
                          <p className="text-sm leading-6 text-muted-foreground">Once OpenAI finishes, copy the final redirect URL from your browser and paste it here.</p>
                        </div>
                      </div>
                      <div className="grid gap-2">
                        <Label htmlFor="subscription-auth-input">Redirect URL</Label>
                        <Input id="subscription-auth-input" value={authInput} onChange={(e) => setAuthInput(e.target.value)} placeholder="Paste the final redirect URL" disabled={!authCanAcceptRedirectInput || authRestartRecovered || authSubmittingRedirect} className="h-12 rounded-xl border-border bg-card px-4" />
                        {authInputValidationError ? <p className="text-sm text-destructive">{authInputValidationError}</p> : null}
                      </div>
                      {authIsVerifyingRedirect ? (
                        <div className="flex items-center gap-3 rounded-xl bg-card px-4 py-4 text-sm text-muted-foreground ring-1 ring-inset ring-border">
                          <LoaderCircle className="size-5 animate-spin text-primary" />
                          <span>Verifying your authorization…</span>
                        </div>
                      ) : null}
                      <Button variant="secondary" size="lg" type="button" disabled={!authCanSubmit} className="w-fit" onClick={() => void sendAuthInput(false)}>
                        {authSubmittingRedirect ? "Verifying…" : "Submit URL"}
                      </Button>
                    </div>
                    <Button size="lg" type="button" variant="outline" className="w-fit" disabled={authCancelling} onClick={() => void cancelAuth()}>
                      {authCancelling ? "Cancelling…" : "Cancel"}
                    </Button>
                    {authJob.logs && authJob.logs.length > 0 ? (
                      <div className="grid gap-2 rounded-xl border border-border bg-muted p-5">
                        <h4 className="text-base font-semibold text-foreground">Authorization logs</h4>
                        <pre className="m-0 max-h-72 overflow-auto whitespace-pre-wrap rounded-xl bg-card p-4 text-sm leading-6 text-muted-foreground ring-1 ring-inset ring-border">{authJob.logs.join("\n")}</pre>
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
                <h3 className="text-base font-semibold text-foreground">
                  {isEditMode ? `Edit — ${labelForProvider(aiProvider)}` : "Add API key"}
                </h3>
                <Button
                  variant="link"
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
                  className="h-auto p-0"
                >
                  ← Back
                </Button>
              </div>
              <div className="grid gap-5">
                <div className="grid gap-2">
                  <Label htmlFor="ai-provider">Provider</Label>
                  <Select
                    value={aiProvider}
                    onValueChange={(raw) => { const v = raw ?? ""; setAiProvider(v); setAiModel(""); setAiBaseUrl(defaultBaseUrlForProvider(v)); setAiApiKey(defaultApiKeyForProvider(v)); setEditingProvider(null); }}
                    disabled={isEditMode}
                  >
                    <SelectTrigger id="ai-provider" className="h-12 w-full rounded-xl border-border bg-card px-4 text-sm disabled:cursor-not-allowed disabled:opacity-60">
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
                  <Input id="ai-api-key" type="password" value={isEditMode ? "" : aiApiKey} onChange={(e) => setAiApiKey(e.target.value)} placeholder={isEditMode ? "••••••••" : "sk-..."} disabled={isEditMode} className="h-12 rounded-xl border-border bg-card px-4 disabled:cursor-not-allowed disabled:opacity-60" />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="ai-model">Model</Label>
                  <Input id="ai-model" value={aiModel} onChange={(e) => setAiModel(e.target.value)} placeholder="gpt-4o, mimo-v2.5… (provider prefix added automatically)" className="h-12 rounded-xl border-border bg-card px-4" />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="ai-base-url">Base URL <span className="text-xs text-muted-foreground">(optional)</span></Label>
                  <Input id="ai-base-url" value={aiBaseUrl} onChange={(e) => setAiBaseUrl(e.target.value)} placeholder="https://api.example.com/v1" className="h-12 rounded-xl border-border bg-card px-4" />
                </div>
                {aiConfig.output ? <p className="text-sm text-status-success">{aiConfig.output}</p> : null}
                {aiConfig.error ? <p className="text-sm text-destructive">{aiConfig.error}</p> : null}
                <div className="flex gap-3">
                  <Button size="lg" type="button" disabled={!canSaveAiConfig} onClick={() => void handleSaveAiConfig()}>
                    {aiConfig.status === "saving" ? "Saving…" : isEditMode ? "Update" : "Save"}
                  </Button>
                  <Button size="lg" type="button" variant="outline" onClick={closePanel}>
                    Cancel
                  </Button>
                </div>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </section>
  );
}
