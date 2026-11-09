import type { ReactNode } from "react";
import { TriangleAlert } from "lucide-react";

/**
 * The "Blocked" card: something a person has to do before the work can go on
 * (a Template-declared blocker on the Mission page, a channel that cannot be
 * published to on the review). One design for every blocking.
 */
export function BlockedNotice({
  children,
  padding = "p-6",
  testId,
}: {
  children: ReactNode;
  /** Tailwind padding, `p-6` as a page section, `p-4` inside a card. */
  padding?: string;
  testId?: string;
}) {
  return (
    <section
      data-testid={testId}
      className={`grid gap-3 rounded-xl border border-status-warning/30 bg-status-warning/10 ${padding}`}
    >
      <h2 className="m-0 flex items-center gap-2 text-sm font-semibold text-status-warning">
        <TriangleAlert aria-hidden="true" className="size-4 shrink-0" />
        Blocked
      </h2>
      <p className="m-0 text-sm text-status-warning">{children}</p>
    </section>
  );
}
