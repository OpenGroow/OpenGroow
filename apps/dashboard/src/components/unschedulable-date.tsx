"use client";

import type { ReactNode } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/**
 * The date picker of a channel whose Publisher cannot schedule (ADR-074): shown
 * disabled, the reason on hover. A disabled control gets no pointer events, so
 * the tooltip hangs on the span around it.
 */
export function UnschedulableDate({ publisher, children }: { publisher: string; children: ReactNode }) {
  const reason = `${publisher} cannot schedule a post: it is published immediately`;
  return (
    <Tooltip>
      <TooltipTrigger delay={100} data-testid="publish-at-immediate" aria-label={reason} render={<span tabIndex={0} className="block w-fit" />}>
        {children}
      </TooltipTrigger>
      <TooltipContent>{reason}</TooltipContent>
    </Tooltip>
  );
}
