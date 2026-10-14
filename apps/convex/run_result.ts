import { v, type Infer } from "convex/values";
import { z } from "zod";

const metadataValueZ = z.union([z.string(), z.number(), z.boolean()]);
const metadataValueV = v.union(v.string(), v.number(), v.boolean());
const additionalDetailsZ = z.record(z.string(), z.unknown());
const additionalDetailsV = v.any();

const blockedResolutionZ = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("link"), url: z.string() }).strict(),
  z.object({ kind: z.literal("execution_device") }).strict(),
]);
const blockedResolutionV = v.union(
  v.object({ kind: v.literal("link"), url: v.string() }),
  v.object({ kind: v.literal("execution_device") }),
);

const artifactExternalZ = z.object({
  /** MCP server name declared by the Agent Template (from manifest.mcpServers). */
  service: z.string(),
  /** Identifier of the deliverable inside that external service. */
  id: z.string(),
});
/** Exported so other tables that reference an external deliverable by
 * `{ service, id }` (e.g. `observations.screenshot`, issue #408) share this
 * one validator instead of re-declaring the same shape. */
export const artifactExternalV = v.object({
  service: v.string(),
  id: v.string(),
});

/**
 * Strict Artifact validator (post-migration, ADR-020 / issue #146).
 *
 * An Artifact MUST carry `external.id` — identity may not live solely in
 * `metadata.articleId` or `metadata.runId`. Artifacts written by agents
 * without `external` are rejected by this validator. Legacy data was migrated
 * to this shape in #146; there is no runtime fallback to the old keys.
 */
const artifactZ = z
  .object({
    /**
     * Content kind, matching the Template's review.kind declaration.
     * Used by the generic renderer to pick the right component.
     */
    kind: z.enum(["markdown", "metadata", "image", "video"]).optional(),
    /**
     * External service reference — the service responsible for the deliverable
     * and the deliverable's identifier within that service. OpenGroow resolves
     * content from this reference; `metadata` is display-only.
     *
     * REQUIRED: an Artifact without `external.id` is rejected (strict contract).
     */
    external: artifactExternalZ,
    /** Display-only key-value pairs. Must NOT be used to resolve Artifact content. */
    metadata: z.record(z.string(), metadataValueZ).optional(),
  })
  .refine(
    (a) => typeof a.external?.id === "string" && a.external.id.length > 0,
    { message: "Artifact must have a non-empty external.id (legacy metadata.articleId / metadata.runId shapes are not accepted)" },
  );
export const artifactV = v.object({
  kind: v.optional(
    v.union(
      v.literal("markdown"),
      v.literal("metadata"),
      v.literal("image"),
      v.literal("video"),
      // Legacy (removed by issue #537): the retired `enrich_observations`
      // Mission's Artifact kind. Nothing writes it any more, but historical
      // Mission/Run rows still carry it and must keep validating on deploy.
      v.literal("observation_deep_analysis"),
    ),
  ),
  external: v.optional(artifactExternalV),
  metadata: v.optional(v.record(v.string(), metadataValueV)),
});

export const runResultSchema = z.discriminatedUnion("status", [
  z
    .object({
      status: z.literal("success"),
      summary: z.string(),
      artifact: artifactZ.optional(),
      additionalDetails: additionalDetailsZ.optional(),
    })
    .strict(),
  z
    .object({
      status: z.literal("needs_human_review"),
      summary: z.string(),
      reviewQuestions: z.array(z.string()),
      artifact: artifactZ.optional(),
      partialArtifact: artifactZ.optional(),
      additionalDetails: additionalDetailsZ.optional(),
    })
    .strict(),
  z
    .object({
      status: z.literal("failed"),
      summary: z.string(),
      error: z
        .object({
          code: z.string(),
          message: z.string(),
        })
        .strict(),
      artifact: artifactZ.optional(),
      additionalDetails: additionalDetailsZ.optional(),
    })
    .strict(),
  // A human-action blocker declared by the Agent Template. This is a normal,
  // terminal, non-error outcome: distinct from `needs_human_review` because
  // the action happens outside OpenGroow (on an MCP dashboard, an execution
  // device, or another Template-owned surface).
  z
    .object({
      status: z.literal("blocked_external"),
      summary: z.string(),
      blockerCode: z.string(),
      message: z.string(),
      resolution: blockedResolutionZ.optional(),
      additionalDetails: additionalDetailsZ.optional(),
    })
    .strict(),
  // Non-terminal: the agent dispatched a long-running MCP job and handed back a
  // pointer to it instead of polling to completion (issue #138). OpenGroow polls
  // the job's status on its own ticks and resolves the run to a terminal state.
  // Distinct from `runResultV` (the stored, terminal-only result validator):
  // an `in_progress` result lives only in the agent's outputs file.
  z
    .object({
      status: z.literal("in_progress"),
      summary: z.string(),
      reviewQuestions: z.array(z.string()),
      job: z
        .object({
          mcpServer: z.string(),
          jobId: z.string(),
          // The MCP tool name the Agent called (e.g. "generate_article",
          // "plan_article"). Disambiguates which of the Mission type's
          // External Job contracts applies once a Mission type has more than
          // one async job (ADR-026).
          jobType: z.string(),
          // SourceJob execution only (issue #533): the `id` the Source write
          // route returned for the `processing` Source this job enriches.
          sourceRef: z.string().optional(),
        })
        .strict(),
      additionalDetails: additionalDetailsZ.optional(),
    })
    .strict(),
]);

// zod v4 dropped `received` from invalid_type issues; it only survives in the
// message ("Invalid input: expected string, received undefined"). The typed
// alternative, `issue.input`, is populated only when every `safeParse` call
// site opts in with `{ reportInput: true }` — callers that forgot would have
// every mismatch silently reported as a missing field, so we read the message
// instead. This ties us to zod's default (English, no custom error map)
// wording, which the pinned `zod ^4.4.3` gives us.
const receivedType = (issue: z.core.$ZodIssueInvalidType): string =>
  /received (\w+)$/.exec(issue.message)?.[1] ?? "unknown";

/**
 * Turn a ZodError from parsing an outputs file into a human-readable sentence.
 * Zod's own `error.message` is a JSON dump of issue objects, which leaks into
 * the "What happened" / run history UI and is unreadable. This collapses the
 * issues into "missing" and "unexpected" field lists plus any type mismatches.
 */
export function formatRunResultIssues(error: z.ZodError, input?: unknown): string {
  const missing: string[] = [];
  const unexpected: string[] = [];
  const other: string[] = [];

  const join = (path: PropertyKey[]) => path.map(String).join(".");

  const valueAtPath = (obj: unknown, path: PropertyKey[]): unknown => {
    let cur: unknown = obj;
    for (const key of path) {
      if (cur && typeof cur === "object") {
        cur = (cur as Record<PropertyKey, unknown>)[key];
      } else {
        return undefined;
      }
    }
    return cur;
  };

  for (const issue of error.issues) {
    // zod v4 reports an unmatched discriminator as `invalid_union` carrying
    // `discriminator` and `options`; a plain (non-discriminated) union failure
    // carries neither, so `options` is what tells the two apart.
    if (issue.code === "invalid_union" && "options" in issue) {
      // The agent wrote a `status` that matches no RunResult branch. Echo the
      // value it actually wrote — otherwise the error is undiagnosable.
      const field = join(issue.path) || "status";
      const got = valueAtPath(input, issue.path);
      const expected = (issue.options ?? []).map((o) => String(o)).join(" | ");
      other.push(
        got !== undefined
          ? `${field} is ${JSON.stringify(got)}, expected one of ${expected}`
          : `${field} must be one of ${expected}`,
      );
    } else if (
      issue.code === "invalid_type" &&
      receivedType(issue) === "undefined"
    ) {
      missing.push(join(issue.path));
    } else if (issue.code === "unrecognized_keys") {
      for (const key of issue.keys) {
        unexpected.push(join([...issue.path, key]));
      }
    } else if (issue.code === "invalid_type") {
      const field = join(issue.path) || "value";
      // v4 names a record's expected type "record"; v3 said "object".
      const expected = issue.expected === "record" ? "object" : issue.expected;
      other.push(
        `${field} should be ${expected} (got ${receivedType(issue)})`,
      );
    } else {
      const field = join(issue.path);
      other.push(field ? `${field}: ${issue.message}` : issue.message);
    }
  }

  const parts: string[] = [];
  if (missing.length > 0) parts.push(`missing ${missing.join(", ")}`);
  if (unexpected.length > 0)
    parts.push(`unexpected ${unexpected.join(", ")}`);
  parts.push(...other);

  const detail =
    parts.length > 0 ? `: ${parts.join("; ")}` : "";
  return `Output file doesn't match the expected format${detail}`;
}

/**
 * Build a human-readable message for when the reconciler cannot read the
 * agent's outputs file. The raw filesystem error — e.g.
 * `ENOENT: no such file or directory, lstat '/home/node/.openclaw/workspace-…/outputs'` —
 * leaks an internal container path and is meaningless in the run-history UI.
 *
 * When the file is simply absent, the agent exited without recording its
 * RunResult. The usual cause is that it stopped polling a long-running
 * background job (e.g. a video render) before that job finished, so the job
 * may well have completed inside its MCP server even though OpenGroow never
 * saw a result. We surface the relative outputs path (which is useful) and
 * drop the absolute one (which is not).
 */
export function formatMissingOutputMessage(
  outputsPath: string,
  rawError?: string,
): string {
  const isAbsent =
    rawError === undefined ||
    /ENOENT|no such file or directory/i.test(rawError);
  if (isAbsent) {
    return (
      `The agent finished without writing its result file (\`${outputsPath}\`). ` +
      `If it was waiting on a long-running job, that job may have completed in ` +
      `its MCP server after the run ended.`
    );
  }
  // A different read failure (e.g. the gateway was unreachable): keep the gist
  // but replace any absolute quoted path with the relative outputs path.
  const sanitized = rawError.replace(/'\/[^']*'/g, `\`${outputsPath}\``);
  return `Could not read the agent's result file (\`${outputsPath}\`): ${sanitized}`;
}

export const runResultV = v.union(
  v.object({
    status: v.literal("success"),
    summary: v.string(),
    artifact: v.optional(artifactV),
    additionalDetails: v.optional(additionalDetailsV),
  }),
  v.object({
    status: v.literal("needs_human_review"),
    summary: v.string(),
    reviewQuestions: v.array(v.string()),
    artifact: v.optional(artifactV),
    partialArtifact: v.optional(artifactV),
    additionalDetails: v.optional(additionalDetailsV),
  }),
  v.object({
    status: v.literal("failed"),
    summary: v.string(),
    error: v.object({
      code: v.string(),
      message: v.string(),
    }),
    artifact: v.optional(artifactV),
    additionalDetails: v.optional(additionalDetailsV),
  }),
  v.object({
    status: v.literal("blocked_external"),
    summary: v.string(),
    blockerCode: v.string(),
    message: v.string(),
    resolution: v.optional(blockedResolutionV),
    additionalDetails: v.optional(additionalDetailsV),
  }),
);

export type RunResult = Infer<typeof runResultV>;
