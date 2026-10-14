/** A SourceJob execution is tried at most this many times (the first one plus its corrections). */
export const MAX_SOURCE_TRIES = 3;

/** One rejected entry of a result: where it was, where it came from, and everything wrong with it. */
export type SourceError = {
  /** Index in the result's `sources`; absent when the whole file is at fault. */
  position?: number;
  origin?: string;
  messages: string[];
};

/**
 * What a failed try hands to the next one, kept on the failed Run's
 * `intermediateResult.feedback`. `accepted` accumulates over the tries so a
 * corrected entry resent together with an accepted one never duplicates it;
 * `surplus` remembers that a try left Sources over the cap.
 */
export type RetryFeedback = {
  errors: SourceError[];
  accepted: string[];
  surplus: boolean;
};

/** What a try reports about itself; the settling merges it with the previous tries. */
export type TryFeedback = { errors: SourceError[]; accepted?: string[]; surplus?: boolean };

/** Identity of an accepted entry within a retry chain. */
export function acceptedKey(entry: { id?: string; sourceId: string; origin: string }): string {
  return entry.id !== undefined ? `id:${entry.id}` : `${entry.sourceId}|${entry.origin}`;
}

/** The complete error list, one readable line per message. */
export function formatSourceErrors(errors: SourceError[]): string {
  return errors
    .flatMap((error) => {
      const where =
        error.position === undefined
          ? "result file"
          : `sources[${error.position}]${error.origin ? ` (${error.origin})` : ""}`;
      return error.messages.map((message) => `${where}: ${message}`);
    })
    .join("\n");
}

/** The feedback stored on a Run's `intermediateResult`, if any. */
export function feedbackOf(intermediateResult: unknown): RetryFeedback | undefined {
  const feedback = (intermediateResult as { feedback?: RetryFeedback } | undefined)?.feedback;
  return feedback && Array.isArray(feedback.errors) ? feedback : undefined;
}
