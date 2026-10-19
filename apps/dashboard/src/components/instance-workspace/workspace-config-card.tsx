import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { PanelIcon } from "@/components/opengroow/settings-panel";
import { Card } from "@/components/ui/card";

/**
 * One integration (channel or external service) of a Project: its icon tile,
 * name, status badge and description on a row, an optional `action` at the
 * right, then the configuration `children` underneath.
 */
export function WorkspaceConfigCard({
  icon,
  tone,
  title,
  description,
  badge,
  action,
  children,
}: {
  icon: LucideIcon;
  tone: "violet" | "cyan" | "blue";
  title: string;
  description: string;
  badge?: ReactNode;
  action?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <Card className="gap-5 py-6">
      <div className="flex flex-wrap items-center justify-between gap-4 px-6">
        <div className="flex min-w-0 flex-1 items-center gap-5">
          <PanelIcon icon={icon} tone={tone} />
          <div className="grid min-w-0 gap-1">
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="m-0 text-lg font-semibold text-foreground">{title}</h2>
              {badge ?? null}
            </div>
            <p className="m-0 max-w-2xl text-base leading-7 text-muted-foreground">{description}</p>
          </div>
        </div>
        {action ?? null}
      </div>
      {children ?? null}
    </Card>
  );
}
