import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/** The one empty/loading/error card shape the Agent Logs page uses, for both
 * the Mission and job lists and the transcript panel. */
export function LogsStatePanel({
  title,
  description,
  tone = "default",
}: {
  title: string;
  description: string;
  tone?: "default" | "error";
}) {
  return (
    <Card
      className={cn(
        "rounded-[1.5rem] border-0 py-4 shadow-none",
        tone === "error" ? "bg-[rgba(84,41,37,0.06)]" : "bg-[rgba(220,230,224,0.22)]",
      )}
    >
      <CardContent className="grid gap-2 px-5">
        <h3 className="m-0 text-[1.05rem] leading-[1.08] tracking-[-0.03em] text-[var(--dashboard-ink)]">
          {title}
        </h3>
        <p className="m-0 text-[0.96rem] leading-7 text-[var(--dashboard-ink-muted)]">
          {description}
        </p>
      </CardContent>
    </Card>
  );
}
