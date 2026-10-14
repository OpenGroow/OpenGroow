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
      className={`${stretch ? "flex h-full flex-col" : ""} gap-5 rounded-[1.5rem] border-0 bg-white/92 py-6 shadow-[0_18px_48px_rgba(25,28,28,0.08)] ring-1 ring-[rgba(0,38,27,0.08)]`}
    >
      <CardHeader className="gap-4 px-6 pb-0">
        <div className="flex items-center justify-between gap-4">
          <div className="flex size-11 items-center justify-center rounded-2xl bg-[rgba(188,237,215,0.7)] text-[var(--dashboard-primary)]">
            {icon}
          </div>
          {badge ?? null}
        </div>
        <div className="space-y-2">
          <CardTitle className="text-[1.35rem] leading-[1.1] tracking-[-0.04em] text-[var(--dashboard-ink)]">
            {title}
          </CardTitle>
          <CardDescription className="max-w-2xl text-base leading-7 text-[var(--dashboard-ink-muted)]">
            {description}
          </CardDescription>
        </div>
      </CardHeader>
      {children ?? null}
      {footer ?? null}
    </Card>
  );
}
