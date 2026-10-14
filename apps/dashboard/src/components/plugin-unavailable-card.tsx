import type { ReactNode } from "react";
import { WorkspaceConfigCard } from "@/src/components/instance-workspace/workspace-config-card";
import type { OptionalPluginId } from "@/src/lib/optional-plugins";

export function PluginUnavailableCard({
  icon,
  title,
  pluginId,
}: {
  icon: ReactNode;
  title: string;
  pluginId: OptionalPluginId;
}) {
  return (
    <WorkspaceConfigCard
      icon={icon}
      title={title}
      description={`Not available on this Instance. Add "${pluginId}" to OPENCLAW_OPTIONAL_PLUGINS and restart it to enable ${title}.`}
    />
  );
}
