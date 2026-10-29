"use client";

import { useEffect, useMemo, useState } from "react";
import { useAction } from "convex/react";
import { Gauge } from "lucide-react";
import { api } from "@convex/_generated/api";
import type { InstanceRecord } from "@/src/components/instance-workspace.types";
import { useAuthenticatedInstances } from "@/src/hooks/use-authenticated-instances";
import { Card } from "@/components/ui/card";

type UsageWindow = {
  label: string;
  usedPercent: number;
  resetAt?: number;
};

type ProviderUsage = {
  provider: string;
  displayName: string;
  windows: UsageWindow[];
  summary?: string;
  plan?: string;
  error?: string;
};

type GetOpenClawUsageResult = {
  status?: number;
  error?: string;
  usage?: {
    parsed: boolean;
    providers: ProviderUsage[];
  };
};

type UsagePanelProps = {
  instanceId: string;
};

// A single discriminated union instead of independent loading/error/providers/
// unrecognizedFormat flags, so the panel can never render two mutually
// exclusive states (e.g. a stale error and a stale providers list) at once.
type UsageState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "data"; providers: ProviderUsage[] }
  | { kind: "unrecognized" };

const resetAtFormatter = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
});

const USAGE_UNAVAILABLE_MESSAGE = "Usage is temporarily unavailable.";

/**
 * Maps any control-API error (which may contain infra-specific wording) to a
 * business-safe message. GLOSSARY.md forbids surfacing infra jargon in the UI.
 */
function toUserFacingUsageError(_rawError: string): string {
  return USAGE_UNAVAILABLE_MESSAGE;
}

export function UsagePanel({ instanceId }: UsagePanelProps) {
  const instances = useAuthenticatedInstances<InstanceRecord>();
  const getOpenClawUsage = useAction(api.instances_node.getOpenClawUsage);

  const [state, setState] = useState<UsageState>({ kind: "loading" });

  const instance = useMemo(
    () => instances?.find((candidate) => candidate.openclawId === instanceId || candidate.jobId === instanceId),
    [instances, instanceId],
  );
  const instanceRecordId = instance?._id;
  const openclawId = instance?.openclawId;

  useEffect(() => {
    if (!instanceRecordId || !openclawId) {
      return;
    }

    let cancelled = false;
    setState({ kind: "loading" });

    void (async () => {
      try {
        const result = (await getOpenClawUsage({
          instanceId: openclawId,
        })) as GetOpenClawUsageResult;

        if (cancelled) {
          return;
        }

        if (result.error) {
          setState({ kind: "error", message: toUserFacingUsageError(result.error) });
          return;
        }

        if (result.usage?.parsed) {
          setState({ kind: "data", providers: result.usage.providers });
        } else {
          setState({ kind: "unrecognized" });
        }
      } catch (e: unknown) {
        if (!cancelled) {
          setState({ kind: "error", message: USAGE_UNAVAILABLE_MESSAGE });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [getOpenClawUsage, instanceRecordId, openclawId]);

  if (!instances) {
    return (
      <Card className="mt-3 p-5">
        <p className="m-0 text-sm text-muted-foreground">Loading usage…</p>
      </Card>
    );
  }

  if (!instance) {
    return (
      <Card className="mt-3 p-5">
        <h2 className="m-0 text-xl font-semibold text-foreground">Usage & Quotas</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          This project is not linked to a running deployment yet, so usage isn't available.
        </p>
      </Card>
    );
  }

  return (
    <Card className="mt-3 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="m-0 text-xl font-semibold text-foreground">Usage & Quotas</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            How much of each model provider's usage window this project's Agents have consumed. This
            covers the whole project — a breakdown per Agent isn't available yet.
          </p>
        </div>
        <Gauge className="size-6 shrink-0 text-primary" />
      </div>

      {state.kind === "loading" ? (
        <p className="mt-4 text-sm text-muted-foreground">Loading usage…</p>
      ) : null}

      {state.kind === "error" ? <p className="mt-4 text-sm text-destructive">{state.message}</p> : null}

      {state.kind === "data" ? (
        state.providers.length > 0 ? (
          <ul className="mt-4 flex flex-col gap-3">
            {state.providers.map((provider, index) => (
              <li
                key={`${index}-${provider.provider}`}
                className="rounded-xl border border-border bg-card/60 p-4"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-medium text-foreground">{provider.displayName}</span>
                  {provider.plan ? (
                    <span className="text-xs text-muted-foreground">{provider.plan}</span>
                  ) : null}
                </div>

                {provider.error ? (
                  <p className="m-0 mt-2 text-sm text-destructive">{provider.error}</p>
                ) : provider.windows.length > 0 ? (
                  <ul className="mt-2 flex flex-col gap-1.5">
                    {provider.windows.map((window, windowIndex) => (
                      <li
                        key={`${windowIndex}-${window.label}`}
                        className="flex flex-wrap items-center justify-between gap-2 text-sm text-foreground"
                      >
                        <span>{window.label}</span>
                        <span className="text-muted-foreground">
                          {Math.round(window.usedPercent)}% used
                          {window.resetAt
                            ? ` · resets ${resetAtFormatter.format(new Date(window.resetAt))}`
                            : ""}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="m-0 mt-2 text-sm text-muted-foreground">
                    No quota windows reported yet.
                  </p>
                )}

                {provider.summary ? (
                  <p className="m-0 mt-2 text-sm text-muted-foreground">{provider.summary}</p>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-4 text-sm text-muted-foreground">
            No usage data yet. Usage appears here once this project's Agents start making LLM calls.
          </p>
        )
      ) : null}

      {state.kind === "unrecognized" ? (
        <p className="mt-4 text-sm text-muted-foreground">
          Usage data unavailable in an unexpected format.
        </p>
      ) : null}
    </Card>
  );
}
