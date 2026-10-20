import type { LucideIcon } from "lucide-react";
import { Ban } from "lucide-react";
import { WorkspaceConfigCard } from "@/src/components/instance-workspace/workspace-config-card";
import { StatusBadge } from "@/components/opengroow/status-badge";
import { Button } from "@/components/ui/button";
import type { OptionalPluginId } from "@/src/lib/optional-plugins";

export function PluginUnavailableCard({
  icon,
  tone,
  title,
  pluginId,
}: {
  icon: LucideIcon;
  tone: "violet" | "cyan" | "blue";
  title: string;
  pluginId: OptionalPluginId;
}) {
  return (
    <WorkspaceConfigCard
      icon={icon}
      tone={tone}
      title={title}
      badge={<StatusBadge tone="neutral" label="Unavailable" />}
      description={`Not available on this Instance. Add "${pluginId}" to OPENCLAW_OPTIONAL_PLUGINS and restart it to enable ${title}.`}
      action={
        <Button variant="outline" size="lg" type="button" disabled>
          <Ban />
          Unavailable on this instance
        </Button>
      }
    />
  );
}
