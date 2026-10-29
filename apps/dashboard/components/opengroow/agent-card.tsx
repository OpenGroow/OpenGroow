import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { AgentAvatar } from "@/components/opengroow/agent-avatar";
import { AGENT_STATUS, agentShortDescription } from "@/components/opengroow/agent-presentation";
import { StatusBadge } from "@/components/opengroow/status-badge";
import { cn } from "@/lib/utils";
import type { AgentCardState } from "@/src/utils/merge-agent-states";

type AgentCardProps = {
  card: AgentCardState;
  instanceId: string;
  runtimeError: string | undefined;
  onActivate: () => void;
};

/**
 * Lightweight Agent card (DESIGN.md): name, short function and state. Run
 * counts and settings live on the Agent's own page.
 */
export function AgentCard({ card, instanceId, runtimeError, onActivate }: AgentCardProps) {
  const { manifest, status, errorMessage, errorLink } = card;
  const displayedError = runtimeError ?? (status === "error" ? errorMessage : undefined);
  // errorLink (Config Completeness, issue #320) only makes sense alongside
  // the persisted errorMessage — a runtime-only error (e.g. a network
  // failure calling the action) has no MCP dashboardUrl to show.
  const displayedErrorLink = status === "error" && !runtimeError ? errorLink : undefined;
  const agentHref = `/projects/${encodeURIComponent(instanceId)}/agents/${encodeURIComponent(card.templateId)}`;
  const indicator = AGENT_STATUS[status];

  const shortDescription = agentShortDescription(card.templateId);

  return (
    <Card
      data-slot="agent-card"
      className={cn(
        "glow-hover relative min-h-40 gap-4 py-5",
        // The whole card is the link of an active Agent (see the title).
        status === "active" &&
          "cursor-pointer transition-colors hover:bg-surface-raised has-[a:focus-visible]:ring-2 has-[a:focus-visible]:ring-ring"
      )}
    >
      <div className="flex flex-1 items-stretch gap-4 px-5 sm:gap-5">
        <AgentAvatar name={manifest.name} category={manifest.category} className="self-start" />
        {/* Name | badge on the first row, description | action on the second:
            the action sits at the card's bottom-right, and every card keeps
            the same height whatever the Agent's state. */}
        <div className="grid min-w-0 flex-1 content-start gap-x-3 gap-y-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:grid-rows-[auto_1fr]">
          <h3 className="m-0 min-w-0 max-w-full text-lg leading-7 font-semibold break-words text-foreground sm:truncate">
            {status === "active" ? (
              <Link
                href={agentHref}
                className="outline-none after:absolute after:inset-0 after:content-['']"
              >
                {manifest.name}
              </Link>
            ) : (
              manifest.name
            )}
          </h3>
          <StatusBadge tone={indicator.tone} label={indicator.label} className="sm:self-center sm:justify-self-end" />
          <p className="m-0 line-clamp-2 min-w-0 text-base leading-6 text-muted-foreground sm:min-h-12">
            {shortDescription ?? manifest.description}
          </p>

          {(status === "inactive" || status === "error") && (
            <Button
              variant="outline"
              type="button"
              onClick={onActivate}
              className="min-w-24 sm:self-end sm:justify-self-end"
            >
              {status === "error" ? "Retry" : "Activate"}
            </Button>
          )}

          {status === "activating" && (
            <Button
              variant="outline"
              type="button"
              loading
              className="min-w-24 sm:self-end sm:justify-self-end"
            >
              Activating…
            </Button>
          )}
        </div>
      </div>

      {displayedError && (
        <p className="m-0 mx-5 rounded-lg bg-destructive/10 px-4 py-3 text-sm leading-6 text-destructive">
          {displayedError}
          {displayedErrorLink && (
            <>
              {" "}
              <a
                href={displayedErrorLink}
                target="_blank"
                rel="noreferrer"
                className="font-semibold underline underline-offset-2"
              >
                Open dashboard
              </a>
            </>
          )}
        </p>
      )}
    </Card>
  );
}
