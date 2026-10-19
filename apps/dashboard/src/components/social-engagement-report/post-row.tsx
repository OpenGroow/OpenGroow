/**
 * One observed post in the Engagement Report: who posted it, what the agent
 * decided and why, and the comment it posted if any.
 *
 * Reads the canonical nested shape only — `normalizeReport` has already
 * folded a flat-written post back into it before this renders.
 */
"use client";

import { useState } from "react";
import { DecisionBadge, ScoreBadge } from "./report-badges";
import type { AnchorRepair, ReportPost } from "./report-schema";
import { Button } from "@/components/ui/button";

/** The resource-id without its package prefix: "com.x:id/g6s" -> "g6s". */
function shortId(resourceId: string | null | undefined): string {
  return resourceId ? resourceId.slice(resourceId.lastIndexOf("/") + 1) : "?";
}

function describeRepair(repair: AnchorRepair): string {
  const confidence = typeof repair.confidence === "number" ? ` (${repair.confidence.toFixed(2)})` : "";
  if (repair.outcome === "persisted") {
    return `Anchor repaired · ${repair.field ?? "?"} ${shortId(repair.from)} → ${shortId(repair.to)}${confidence}`;
  }
  const proposal = repair.to ? ` ${shortId(repair.to)}${confidence}` : "";
  return `Anchor repair failed · ${repair.field ?? "?"}${proposal} (${repair.outcome ?? "unknown"})`;
}

type PostRowProps = {
  post: ReportPost;
};

export function PostRow({ post }: PostRowProps) {
  const [expanded, setExpanded] = useState(false);
  // `post` arrives already reshaped into the canonical nested shape by
  // normalizeReport — a report written with these fields flat on the post
  // has been folded back into postSummary/agentEvaluation there.
  const accountHandle = post.postSummary?.accountHandle;
  const decision = post.agentEvaluation?.decision;
  const caption = post.postSummary?.caption;
  const relevanceScore = post.agentEvaluation?.relevanceScore;
  const relevanceReason = post.agentEvaluation?.relevanceReason;
  const classifier = post.classifierEvaluation;
  const visualDescription = post.visualDescription;
  const visualDescriptionStatus = post.visualDescriptionStatus;
  // Legacy actions-based comment (pre-commentAction schema, see LegacyPostAction)
  const legacyCommentAction = Array.isArray(post.actions)
    ? post.actions.find((a) => a.type === "comment")
    : undefined;
  const commentAction = post.agentEvaluation?.commentAction;

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex gap-3">
        {/* Content */}
        <div className="min-w-0 flex-1 grid gap-1.5">
          {/* Top row: username + decision */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-sm text-foreground">
              @{accountHandle ?? "—"}
            </span>
            <DecisionBadge decision={decision} />
            <ScoreBadge score={relevanceScore} />
          </div>

          {/* Caption (truncated unless expanded) */}
          {caption && (
            <p
              className={`text-sm leading-5 text-muted-foreground ${expanded ? "" : "line-clamp-2"}`}
            >
              {caption}
            </p>
          )}

          {/* jev's answer for this post: the two probabilities, or why there
              are none. Absent for reports written before jev was recorded. */}
          {classifier && (
            <p className="text-xs font-medium text-muted-foreground">
              {classifier.status === "available" &&
              classifier.shouldLikeScore !== undefined &&
              classifier.shouldCommentScore !== undefined
                ? `jev · like ${classifier.shouldLikeScore.toFixed(2)} · comment ${classifier.shouldCommentScore.toFixed(2)}`
                : `jev unavailable${classifier.failureReason ? ` (${classifier.failureReason})` : ""}`}
            </p>
          )}

          {/* Drifted app anchors re-resolved (or not) while handling this post. */}
          {post.anchorRepairs?.map((repair, i) => (
            <p key={i} className="text-xs font-medium text-muted-foreground">
              {describeRepair(repair)}
            </p>
          ))}

          {/* Visual Description: what the local VLM read off the post's media,
              or why it produced nothing (Ollama down, no crop area...). Absent
              entirely when the run never asked for one. */}
          {(visualDescription || visualDescriptionStatus?.ok === false) && (
            <div className="rounded-xl border border-border bg-background px-3 py-2">
              <p className="text-sm text-muted-foreground">
                <span className="font-semibold">Visual description: </span>
                {visualDescription ? (
                  <span
                    className={`whitespace-pre-line text-foreground ${expanded ? "" : "line-clamp-3"}`}
                  >
                    {visualDescription}
                  </span>
                ) : (
                  <span className="italic text-muted-foreground">
                    unavailable{visualDescriptionStatus?.reason ? ` (${visualDescriptionStatus.reason})` : ""}
                  </span>
                )}
              </p>
            </div>
          )}

          {/* Relevance reason */}
          {relevanceReason && (
            <p className="text-sm italic text-muted-foreground">
              {relevanceReason}
            </p>
          )}

          {/* Comment action (agentEvaluation.commentAction). Also render when
              only commentPostReason is set: a comment flow that was entered but
              posted nothing still needs to show *why* it didn't. */}
          {commentAction && (commentAction.commentsLiked?.length || commentAction.commentPosted || commentAction.commentPostReason) && (
            <div className="rounded-xl border border-border bg-background px-3 py-2 grid gap-1.5">
              {commentAction.commentsLiked && commentAction.commentsLiked.length > 0 && (
                <p className="text-sm text-muted-foreground">
                  <span className="font-semibold">Liked comments: </span>
                  {commentAction.commentsLiked.map((i) => `#${i + 1}`).join(", ")}
                </p>
              )}
              {commentAction.commentPosted && (
                <p className="text-sm text-foreground">
                  <span className="font-semibold text-muted-foreground">Comment posted: </span>
                  {commentAction.commentPosted}
                </p>
              )}
              {commentAction.commentPostReason && (
                <p className="text-sm italic text-muted-foreground">
                  {commentAction.commentPostReason}
                </p>
              )}
            </div>
          )}

          {/* Legacy comment posted (pre-commentAction schema) */}
          {!commentAction && legacyCommentAction?.commentPosted && (
            <div className="rounded-xl border border-border bg-background px-3 py-2">
              <p className="text-sm text-foreground">
                <span className="font-semibold text-muted-foreground">Comment: </span>
                {legacyCommentAction.commentPosted}
              </p>
            </div>
          )}

          {/* Expand / collapse */}
          {((caption && caption.length > 80) || (visualDescription && visualDescription.length > 160)) && (
            <Button
              variant="outline"
              size="sm"
              type="button"
              onClick={() => { setExpanded((v) => !v); }}
              className="self-start"
            >
              {expanded ? "Show less" : "Show more"}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
