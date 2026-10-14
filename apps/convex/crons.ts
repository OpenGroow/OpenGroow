import { cronJobs } from "convex/server";
import { internal } from "./_generated/api.js";

const crons = cronJobs();

crons.interval(
  "mission-dispatcher-tick",
  { seconds: 10 },
  internal.mission_dispatcher_node.tick,
);

// Scans the user-defined `schedules` table for due Schedules and fires a Mission
// for each. Distinct from mission-dispatcher-tick (which drives Run dispatch).
crons.interval(
  "schedule-tick",
  { minutes: 1 },
  internal.schedules.tick,
);

// SourceJob tick (ADR-051, issue #531): starts one Agent session per due
// SourceJob.
crons.interval(
  "source-job-tick",
  { minutes: 1 },
  internal.source_jobs.tick,
);

// Generic Job scheduling (issue #595): Source scoring is provisioned from the
// Source Agent manifest and dispatched by the generic Job dispatcher.
crons.interval(
  "score-job-tick",
  { minutes: 1 },
  internal.score_jobs.tick,
);

// Issue #493: a WhatsApp channel stuck "configured but never linked" made
// OpenClaw retry every ~30-40s forever, each retry re-running a full LLM
// agent turn (946.9M tokens burned in a day). Probes such channels and
// auto-disables them after WHATSAPP_LINK_FAILURE_THRESHOLD consecutive
// failures rather than letting them retry indefinitely.
crons.interval(
  "whatsapp-link-watchdog",
  { minutes: 5 },
  internal.instances_node.runWhatsAppLinkWatchdogTick,
);

// Source routing Job (issue #598): Convex ranks and thresholds Sources, then
// the Source Agent proposes only the production Mission type to create.
crons.interval(
  "source-routing-job-tick",
  { minutes: 1 },
  internal.source_routing.tick,
);

export default crons;
