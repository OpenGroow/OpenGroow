import type { ReactNode } from "react";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export function WorkspaceConfigCard({
  icon,
  title,
  description,
  badge,
  children,
  footer,
  stretch = false,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  badge?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  stretch?: boolean;
}) {
  return (
    <Card
      className={`${stretch ? "flex h-full flex-col" : ""} gap-5 rounded-xl border-0 bg-card py-6  ring-1 ring-border`}
    >
      <CardHeader className="gap-4 px-6 pb-0">
        <div className="flex items-center justify-between gap-4">
          <div className="flex size-11 items-center justify-center rounded-xl bg-primary/15 text-primary">
            {icon}
          </div>
          {badge ?? null}
        </div>
        <div className="space-y-2">
          <CardTitle className="text-lg tracking-tight text-foreground">
            {title}
          </CardTitle>
          <CardDescription className="max-w-2xl text-base leading-7 text-muted-foreground">
            {description}
          </CardDescription>
        </div>
      </CardHeader>
      {children ?? null}
      {footer ?? null}
    </Card>
  );
}
