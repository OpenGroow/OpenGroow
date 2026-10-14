import { JOB_TYPE_NAMES } from "./job-declarations";
import { OFFICIAL_SCOPE } from "./official-scope";

/** Mirrors `templateOriginV` (apps/convex/validators.ts); the origin is never caller-chosen. */
export type InstallOrigin = "local_folder" | "linked_folder" | "git" | "hub";

/**
 * Reservation of the `@opengroow` scope (#666, PRD #642): it keeps a community
 * package from impersonating the Source Agent and capturing every Project's
 * Sources. Two rules, run at install time on every path (install, link,
 * update offer):
 *
 * 1. Only a package in the `@opengroow` scope may declare `category: "system"`
 *    or a reserved Job type (`JOB_TYPE_NAMES`).
 * 2. A `@opengroow` package is only accepted from the origin `hub`.
 *
 * What counts as "the official hub": the origin `hub` is set only by the
 * server-side hub install, which downloads from the hub the deployment is
 * configured with (`OPENGROOW_HUB_REPOSITORY`) and checks the archive digest
 * against the index; the hub index parser itself refuses a `@opengroow` entry
 * that is not marked `official`. So `@opengroow` + `hub` is an official
 * package. Local folder, linked folder and Git installs are refused for that
 * scope: official Templates are installed from the hub. This function is the
 * policy only; the caller skips it on a self-hosted deployment, whose operator
 * owns what it installs.
 *
 * Returns the refusal message, or undefined when the package is allowed.
 */
export function scopeReservationProblem(
  manifest: { id: string; category: string; jobTypes?: readonly { type: string }[] },
  origin: InstallOrigin,
): string | undefined {
  if (manifest.id.startsWith(OFFICIAL_SCOPE)) {
    return origin === "hub"
      ? undefined
      : `Template "${manifest.id}" is refused: the @opengroow scope is reserved to packages installed from the official hub (origin "${origin}")`;
  }
  if (manifest.category === "system") {
    return `Template "${manifest.id}" is refused: only the @opengroow scope may declare category "system"`;
  }
  const reserved = manifest.jobTypes?.find((job) => (JOB_TYPE_NAMES as readonly string[]).includes(job.type));
  if (reserved) {
    return `Template "${manifest.id}" is refused: the Job type "${reserved.type}" is reserved to the @opengroow scope`;
  }
  return undefined;
}
