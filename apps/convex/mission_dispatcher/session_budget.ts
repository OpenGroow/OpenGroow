import { env } from "../env.js";
import type { TemplateRegistry } from "@opengroow/agent-templates/registry";

// Margin above a Template's declared `sessionDurationMs.max` so the Agent has
// time to write its RunResult after its own session budget expires, before
// the watchdog below force-kills the Run.
export const SESSION_FINALIZATION_MARGIN_MS = 300_000;

// Session budget assumed for a session-bound Mission type when its Mission
// carries no `sessionDurationMs` override — expressed so that adding
// `SESSION_FINALIZATION_MARGIN_MS` back on top (see `runMaxMsFromSessionBudget`)
// lands on the same total deadline every other Mission type gets
// (`MISSION_RUN_MAX_MS`). There is no Template-level hardcoded default to
// keep in sync with this. A function (not a module-level const) so it keeps
// reading `env.MISSION_RUN_MAX_MS` live rather than freezing it at import time.
function defaultSessionBudgetMs(): number {
  return env.MISSION_RUN_MAX_MS - SESSION_FINALIZATION_MARGIN_MS;
}

// A Mission's `payload` may carry a `sessionDurationMs` override (ms) for
// Mission types that declare a Template-level session budget (e.g.
// an `engage` Mission type) — lets each Mission (including recurring
// Schedule-triggered ones) run a shorter or longer session than the
// Template's default. Only a finite, strictly positive number is honored;
// anything else (missing, wrong type, 0, negative, NaN) is ignored.
function extractSessionDurationOverrideMs(payload: unknown): number | undefined {
  if (payload === null || typeof payload !== "object") return undefined;
  const raw = (payload as Record<string, unknown>).sessionDurationMs;
  return typeof raw === "number" && Number.isFinite(raw) && raw > 0 ? raw : undefined;
}

/**
 * The session budget (ms) for a Mission type that declares a Template-level
 * `sessionDurationMs`, honoring a per-Mission override from `payload` if
 * valid — or `undefined` for Mission types with no session concept (the
 * override is meaningless there and ignored). With no override, falls back
 * to the same generic deadline every other Mission type gets
 * (`MISSION_RUN_MAX_MS`), expressed as a session budget so
 * `computeRunMaxMs`'s `+ margin` still lands on that same total — there is
 * no more Template-level hardcoded default to keep in sync.
 */
export async function computeSessionBudgetMs(
  registry: TemplateRegistry,
  projectId: string,
  templateId: string,
  missionType: string,
  payload?: unknown,
): Promise<number | undefined> {
  // `sessionDurationMs`'s presence (not its value) is what marks this
  // Mission type as session-bound — declared once in the manifest so the
  // Android plugin nudge and `.session` pre-seed apply to it.
  const isSessionBound = (await registry.resolve(projectId, templateId))?.manifest.missionTypes?.some(
    (entry) => entry.type === missionType && entry.sessionDurationMs !== undefined,
  );
  if (!isSessionBound) return undefined;
  return extractSessionDurationOverrideMs(payload) ?? defaultSessionBudgetMs();
}

/**
 * The hard watchdog timeout (ms) for a Run whose session budget is already
 * known — e.g. because the caller just called `computeSessionBudgetMs` for
 * another purpose (like seeding `.session`) and shouldn't look up the
 * Template a second time. `undefined` (no session concept) falls back to the
 * global env var.
 */
export function runMaxMsFromSessionBudget(sessionBudgetMs: number | undefined): number {
  return sessionBudgetMs !== undefined ? sessionBudgetMs + SESSION_FINALIZATION_MARGIN_MS : env.MISSION_RUN_MAX_MS;
}

/**
 * The hard watchdog timeout for a Run, in ms. Templates that declare
 * a Mission type's `sessionDurationMs` (time-bounded Agent sessions, e.g.
 * an `engage` session) gets a timeout derived from its own session length plus a
 * finalization margin. Other Mission types fall back to the global env var.
 */
export async function computeRunMaxMs(
  registry: TemplateRegistry,
  projectId: string,
  templateId: string,
  missionType: string,
  payload?: unknown,
): Promise<number> {
  return runMaxMsFromSessionBudget(
    await computeSessionBudgetMs(registry, projectId, templateId, missionType, payload),
  );
}
