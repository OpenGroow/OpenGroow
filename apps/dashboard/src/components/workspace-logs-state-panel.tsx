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
        "rounded-xl border-0 py-4 shadow-none",
        tone === "error" ? "bg-destructive/10" : "bg-muted",
      )}
    >
      <CardContent className="grid gap-2 px-5">
        <h3 className="m-0 text-base tracking-tight text-foreground">
          {title}
        </h3>
        <p className="m-0 text-base leading-7 text-muted-foreground">
          {description}
        </p>
      </CardContent>
    </Card>
  );
}
