"use client";

import * as React from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { AgentManifest } from "@convex/template_manifest_contract";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
    <section className="grid max-w-3xl gap-3">
      <h2 className="m-0 text-lg font-semibold text-foreground">MCP server URLs</h2>
      <p className="m-0 text-sm text-muted-foreground">
        Override the URL a server of this Template is reached at. Leave it empty to use the URL the Template declares.
        A localhost URL is reachable from the OpenClaw container.
      </p>
      {manifest.mcpServers.map((server) => (
        <McpUrlRow
          key={server.name}
          instanceId={instanceId}
          templateId={manifest.id}
          serverName={server.name}
          saved={overrides.find((o) => o.serverName === server.name)?.url ?? ""}
          declaredUrl={server.url}
        />
      ))}
    </section>
  );
}

function McpUrlRow({
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
    <div className="grid gap-1.5">
      <label htmlFor={inputId} className="text-xs font-medium text-muted-foreground">
        {serverName}
      </label>
      <div className="flex gap-2">
        <Input
          id={inputId}
          value={value}
          placeholder={saved === "" ? declaredUrl : "Template default"}
          onChange={(event) => setValue(event.target.value)}
          disabled={busy}
        />
        <Button type="button" disabled={busy || value.trim() === saved} onClick={() => void save()}>
          Save
        </Button>
      </div>
      {error ? <p className="m-0 text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
