import Link from "next/link";
import { LogsPanel } from "@/src/components/logs-panel";

export default function DeveloperPage() {
  return (
    <main className="mx-auto mb-20 mt-12 grid w-[min(1040px,92vw)] gap-5">
      <section className="relative grid gap-4 overflow-hidden rounded-[2rem] bg-[rgba(255,255,255,0.8)] p-8 shadow-[0_18px_48px_rgba(25,28,28,0.08)] backdrop-blur-[24px] before:absolute before:left-8 before:top-0 before:h-[4px] before:w-[clamp(7rem,15vw,10rem)] before:rounded-full before:bg-[linear-gradient(135deg,var(--dashboard-primary),var(--dashboard-primary-container))] before:content-['']">
        <span className="text-[0.75rem] font-bold uppercase tracking-[0.18em] text-[var(--dashboard-ink-soft)]">
          Runtime
        </span>
        <h1 className="m-0 text-[clamp(2rem,4vw,3.5rem)] leading-[0.98] tracking-[-0.05em] text-[var(--dashboard-ink)]">
          Developer
        </h1>
        <p className="m-0 text-[0.9375rem] leading-[1.7] text-[var(--dashboard-ink-muted)]">
          One-click status and logs for OpenClaw + broker.
        </p>
        <div className="flex flex-wrap gap-3">
          <Link
            href="/"
            className="inline-flex min-h-10 items-center justify-center rounded-full bg-[var(--dashboard-surface-container-low)] px-4 py-2 text-[0.875rem] leading-[1.3] text-[var(--dashboard-ink-muted)] shadow-[inset_0_0_0_1px_var(--dashboard-outline)] transition-[background-color,color,transform] duration-150 hover:-translate-y-px hover:bg-[var(--dashboard-secondary-container)] hover:text-[var(--dashboard-on-secondary-container)]"
          >
            Back to Dashboard
          </Link>
        </div>
      </section>
      <LogsPanel />
    </main>
  );
}
