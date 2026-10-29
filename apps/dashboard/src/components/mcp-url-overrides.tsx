"use client";

import * as React from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { AgentManifest } from "@convex/template_manifest_contract";
import { Database } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SettingsPanel } from "@/components/opengroow/settings-panel";
import { extractConvexErrorMessage } from "@/src/lib/convex-error";

type Props = {
  instanceId: string;
  manifest: AgentManifest;
};

/**
 * Self-host only (#654): point each MCP server of this Template at the
 * operator's own instance. The caller renders it on self-hosted deployments
 * only; Convex refuses the writes anywhere else, and itself pushes a saved
 * override to the running Agent's runtime config.
 */
export function McpUrlOverrides({ instanceId, manifest }: Props) {
  const overrides = useQuery(api.template_mcp_overrides.listForTemplate, {
    projectId: instanceId,
    templateId: manifest.id,
  });
  if (overrides === undefined) return null;
  return (
    <>
      {manifest.mcpServers.map((server) => (
        <McpServerPanel
          key={server.name}
          instanceId={instanceId}
          templateId={manifest.id}
          serverName={server.name}
          saved={overrides.find((o) => o.serverName === server.name)?.url ?? ""}
          declaredUrl={server.url}
        />
      ))}
    </>
  );
}

function McpServerPanel({
  instanceId,
  templateId,
  serverName,
  saved,
  declaredUrl,
}: {
  instanceId: string;
  templateId: string;
  serverName: string;
  saved: string;
  /** The URL the Template declares. The manifest carries it only while no override is saved. */
  declaredUrl: string;
}) {
  const setOverride = useMutation(api.template_mcp_overrides.set);
  const clearOverride = useMutation(api.template_mcp_overrides.clear);
  const [value, setValue] = React.useState(saved);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | undefined>();

  React.useEffect(() => setValue(saved), [saved]);

  async function save() {
    setBusy(true);
    setError(undefined);
    try {
      const key = { projectId: instanceId, templateId, serverName };
      if (value.trim() === "") await clearOverride(key);
      else await setOverride({ ...key, url: value });
    } catch (err) {
      setError(extractConvexErrorMessage(err, "Saving the URL failed"));
    } finally {
      setBusy(false);
    }
  }

  const inputId = `mcp-url-${serverName}`;
  return (
    <SettingsPanel
      icon={Database}
      tone="cyan"
      title="MCP server configuration"
      description="Configure the MCP server used by this Agent. Leave the URL empty to use the default from the Template."
      dirty={value.trim() !== saved}
      saving={busy}
      error={error}
      onSave={() => void save()}
      onCancel={() => {
        setValue(saved);
        setError(undefined);
      }}
    >
      <div className="grid gap-2">
        <Label htmlFor={`${inputId}-name`}>Server name</Label>
        <Input id={`${inputId}-name`} value={serverName} readOnly />
        <p className="m-0 text-sm text-muted-foreground">Defined by the Template.</p>
      </div>
      <div className="grid gap-2">
        <Label htmlFor={inputId}>Custom URL (optional)</Label>
        <Input
          id={inputId}
          value={value}
          placeholder={saved === "" ? declaredUrl : "Template default"}
          onChange={(event) => setValue(event.target.value)}
          disabled={busy}
        />
        <p className="m-0 text-sm text-muted-foreground">A localhost URL is reachable from the OpenClaw container.</p>
      </div>
    </SettingsPanel>
  );
}
