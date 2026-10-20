import Link from "next/link";
import { LogsPanel } from "@/src/components/logs-panel";

export default function DeveloperPage() {
  return (
    <main className="mx-auto mb-20 mt-12 grid w-[min(1040px,92vw)] gap-5">
      <section className="relative grid gap-4 overflow-hidden rounded-xl bg-card p-8 backdrop-blur-[24px] before:absolute before:left-8 before:top-0 before:h-[4px] before:w-[clamp(7rem,15vw,10rem)] before:rounded-full before:bg-primary before:content-['']">
        <span className="text-xs font-semibold text-muted-foreground">
          Runtime
        </span>
        <h1 className="m-0 text-2xl tracking-tight text-foreground">
          Developer
        </h1>
        <p className="m-0 text-sm text-muted-foreground">
          One-click status and logs for OpenClaw + broker.
        </p>
        <div className="flex flex-wrap gap-3">
          <Link
            href="/"
            className="inline-flex min-h-10 items-center justify-center rounded-full bg-muted px-4 py-2 text-sm text-muted-foreground ring-1 ring-inset ring-border transition-[background-color,color,transform] duration-150 hover:-translate-y-px hover:bg-accent hover:text-accent-foreground"
          >
            Back to Dashboard
          </Link>
        </div>
      </section>
      <LogsPanel />
    </main>
  );
}
