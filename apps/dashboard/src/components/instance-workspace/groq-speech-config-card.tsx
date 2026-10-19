"use client";

import { Mic } from "lucide-react";
import { WorkspaceConfigCard } from "@/src/components/instance-workspace/workspace-config-card";
import { WorkspaceStatusBadge } from "@/src/components/instance-workspace/workspace-status-badge";
import type { SpeechToTextConfigState } from "@/src/components/instance-workspace.types";
import { Button } from "@/components/ui/button";
import { CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

export function GroqSpeechConfigCard({
  apiKey,
  enabled,
  config,
  configured,
  canSave,
  onApiKeyChange,
  onEnabledChange,
  onSave,
}: {
  apiKey: string;
  enabled: boolean;
  config: SpeechToTextConfigState;
  configured: boolean;
  canSave: boolean;
  onApiKeyChange: (value: string) => void;
  onEnabledChange: (value: boolean) => void;
  onSave: () => void;
}) {
  const badge =
    config.status === "saving" ? (
      <WorkspaceStatusBadge label="Saving" tone="muted" />
    ) : configured ? (
      <WorkspaceStatusBadge
        label={enabled ? "Enabled" : "Disabled"}
        tone={enabled ? "success" : "muted"}
      />
    ) : undefined;

  return (
    <WorkspaceConfigCard
      icon={<Mic className="size-5" />}
      title="Groq Speech-to-Text"
      description="Transcribe incoming voice notes with Groq Whisper and feed the transcript into OpenClaw without echoing it back to the chat."
      badge={badge}
    >
      <CardContent className="grid gap-5 px-6">
        <div className="grid gap-3">
          <Label htmlFor="groq-api-key">GROQ_API_KEY</Label>
          <Input
            id="groq-api-key"
            type="password"
            value={apiKey}
            onChange={(event) => onApiKeyChange(event.target.value)}
            placeholder="gsk_..."
            className="h-12 rounded-xl border-border bg-muted px-4"
          />
          <p className="text-sm leading-6 text-muted-foreground">
            Leave this empty on later saves to keep the current Groq key already
            stored on the Project.
          </p>
        </div>

        <div className="flex flex-col gap-4 rounded-xl border border-border bg-muted p-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="grid gap-1">
            <h4 className="text-base font-semibold text-foreground">
              Enable speech-to-text
            </h4>
            <p className="text-sm leading-6 text-muted-foreground">
              When enabled, OpenClaw routes incoming audio transcription through
              Groq only.
            </p>
          </div>
          <Switch
            checked={enabled}
            onCheckedChange={(checked) => onEnabledChange(checked === true)}
            aria-label="Enable speech-to-text"
          />
        </div>

        <div className="flex flex-wrap gap-3">
          <Button size="lg"
            type="button"
            disabled={!canSave}
            onClick={onSave}
          >
            {config.status === "saving"
              ? "Saving…"
              : enabled
                ? "Save and enable"
                : "Save"}
          </Button>
        </div>

        {config.output ? (
          <p className="text-sm text-status-success">{config.output}</p>
        ) : null}
        {config.error ? (
          <p className="text-sm text-destructive">{config.error}</p>
        ) : null}
      </CardContent>
    </WorkspaceConfigCard>
  );
}
