"use client";

import Link from "next/link";
import { use, useEffect, useRef, useState } from "react";
import { useQuery, useAction } from "convex/react";
import { useRouter } from "next/navigation";
import { api } from "@convex/_generated/api";
import type { Doc, Id } from "@convex/_generated/dataModel";
import { WorkspaceMarkdown } from "@/src/components/workspace-markdown";
import {
  SocialEngagementReport,
  isSocialEngagementReport,
} from "@/src/components/social-engagement-report/social-engagement-report";

type Props = {
  params: Promise<{ instanceId: string; missionId: string }>;
};

type CarouselReviewSlide = {
  text: string;
  imageUrls: Record<string, string>;
};

type CarouselReviewPayload = {
  brief?: string;
  status?: string;
  platforms?: string[];
  slides: CarouselReviewSlide[];
  missingImages: string[];
};

type ReviewActionDescriptor = {
  key: string;
  label: string;
  requiredStatus: string;
  inputs: Array<{
    key: string;
    label: string;
    type: "text" | "datetime-local";
    required: boolean;
  }>;
  enabled: boolean;
  disabledReason?: string;
};

function isRenderableImageUrl(value: string): boolean {
  if (value.startsWith("/")) return true;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function parseCarouselReviewPayload(content: string): CarouselReviewPayload | null {
  try {
    const parsed: unknown = JSON.parse(content);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const record = parsed as Record<string, unknown>;
    if (!Array.isArray(record.slides)) return null;
    const platforms = Array.isArray(record.platforms)
      ? record.platforms.filter((platform): platform is string => typeof platform === "string")
      : [];
    const missingImages: string[] = [];

    const slides = record.slides.flatMap((raw, index): CarouselReviewSlide[] => {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
      const slide = raw as Record<string, unknown>;
      const imageUrls: Record<string, string> = {};
      if (slide.imageUrls && typeof slide.imageUrls === "object" && !Array.isArray(slide.imageUrls)) {
        for (const [platform, url] of Object.entries(slide.imageUrls as Record<string, unknown>)) {
          if (typeof url === "string" && isRenderableImageUrl(url)) imageUrls[platform] = url;
        }
      }
      if (platforms.length > 0) {
        for (const platform of platforms) {
          if (imageUrls[platform] === undefined) missingImages.push(`slide ${index + 1} / ${platform}`);
        }
      } else if (Object.keys(imageUrls).length === 0) {
        missingImages.push(`slide ${index + 1} / any platform`);
      }
      return [{ text: typeof slide.text === "string" ? slide.text : "", imageUrls }];
    });

    return {
      brief: typeof record.brief === "string" ? record.brief : undefined,
      status: typeof record.status === "string" ? record.status : undefined,
      platforms: platforms.length > 0 ? platforms : undefined,
      slides,
      missingImages,
    };
  } catch {
    return null;
  }
}

function CarouselReviewContent({ content }: { content: string }) {
  const carousel = parseCarouselReviewPayload(content);
  if (!carousel) {
    return <p className="text-[0.88rem] text-red-700">Carousel review content is invalid.</p>;
  }

  return (
    <div className="grid gap-6" data-testid="carousel-review-content">
      {(carousel.brief || carousel.status) && (
        <div className="grid gap-1 text-[0.92rem] text-[var(--dashboard-ink-muted)]">
          {carousel.brief && <p className="m-0">{carousel.brief}</p>}
          {carousel.status && <p className="m-0 text-xs uppercase tracking-[0.14em]">Status: {carousel.status}</p>}
        </div>
      )}
      {carousel.missingImages.length > 0 && (
        <p
          role="alert"
          data-testid="carousel-missing-images"
          className="m-0 rounded-xl border border-red-700/30 bg-red-50 px-4 py-3 text-[0.88rem] text-red-800"
        >
          Missing rendered variants: {carousel.missingImages.join(", ")}. Approval is disabled until every requested platform is rendered.
        </p>
      )}
      {carousel.slides.map((slide, index) => (
        <article key={`slide-${index + 1}`} className="grid gap-3">
          <h3 className="m-0 text-sm font-bold uppercase tracking-[0.14em] text-[var(--dashboard-ink-soft)]">
            Slide {index + 1}
          </h3>
          {slide.text && <p className="m-0 text-[0.95rem] text-[var(--dashboard-ink)]">{slide.text}</p>}
          <div className="grid gap-4 sm:grid-cols-2">
            {Object.entries(slide.imageUrls).map(([platform, url]) => (
              <figure key={`${index}-${platform}`} className="m-0 grid gap-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={url}
                  alt={`${platform} variant for slide ${index + 1}`}
                  className="w-full rounded-xl border border-[rgba(0,38,27,0.08)] object-contain shadow-sm"
                  data-testid={`carousel-image-${index + 1}-${platform}`}
                />
                <figcaption className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--dashboard-ink-soft)]">
                  {platform}
                </figcaption>
              </figure>
            ))}
          </div>
        </article>
      ))}
    </div>
  );
}

function ReviewCover({ src }: { src: string }) {
  const maxRetries = 4;
  const [retryCount, setRetryCount] = useState(0);
  const [failed, setFailed] = useState(false);
  const retryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setRetryCount(0);
    setFailed(false);
    return () => {
      if (retryTimeoutRef.current) clearTimeout(retryTimeoutRef.current);
      retryTimeoutRef.current = null;
    };
  }, [src]);

  if (failed) return null;

  const imageSrc = retryCount === 0
    ? src
    : `${src}${src.includes("?") ? "&" : "?"}retry=${retryCount}`;

  return (
    <section className="overflow-hidden rounded-[1.75rem] border border-[rgba(0,38,27,0.08)] shadow-[0_18px_34px_rgba(25,28,28,0.06)]">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        key={retryCount}
        src={imageSrc}
        alt="Cover"
        className="w-full object-cover"
        data-testid="review-cover"
        onError={() => {
          if (retryCount < maxRetries) {
            retryTimeoutRef.current = setTimeout(
              () => setRetryCount((current) => current + 1),
              2000 * (retryCount + 1),
            );
          } else {
            setFailed(true);
          }
        }}
      />
    </section>
  );
}

export function MissionReviewPage({ params }: Props) {
  const { instanceId, missionId } = use(params);
  return (
    <MissionReviewContent
      instanceId={decodeURIComponent(instanceId)}
      missionId={decodeURIComponent(missionId)}
    />
  );
}

export function MissionViewPage({ params }: Props) {
  const { instanceId, missionId } = use(params);
  return (
    <MissionReviewContent
      instanceId={decodeURIComponent(instanceId)}
      missionId={decodeURIComponent(missionId)}
      readOnly
    />
  );
}

// Renders the indexing mirror snapshotted at publication (ADR-015): green for a
// submitted submission, red with the verbatim MCP message for an error, and
// nothing at all when indexing was skipped or never recorded.
function IndexingBadge({ indexing }: { indexing: Doc<"missions">["indexing"] }) {
  if (!indexing || indexing.status === "skipped") return null;

  if (indexing.status === "submitted") {
    return (
      <p className="inline-flex w-fit items-center gap-2 rounded-full border border-green-700/30 bg-green-50 px-3 py-1 text-[0.82rem] font-semibold text-green-800">
        Indexing submitted
      </p>
    );
  }

  return (
    <p className="inline-flex w-fit items-center gap-2 rounded-full border border-red-700/30 bg-red-50 px-3 py-1 text-[0.82rem] font-semibold text-red-800">
      Indexing failed: {indexing.error}
    </p>
  );
}

/**
 * Generic action affordance panel driven by Template-declared action capabilities
 * (ADR-020). Renders action buttons and input fields declared by the Template;
 * calls `performReviewAction` with the resolved missionId, action key, and input.
 *
 * Reject capabilities are intentionally excluded from this panel — they are
 * rendered by `RejectSection` which provides the expand-on-click feedback UX.
 */
function ReviewActionsSection({
  missionId,
  instanceId,
  status,
  actions,
  disabled = false,
}: {
  missionId: string;
  instanceId: string;
  status: string;
  actions: ReviewActionDescriptor[];
  disabled?: boolean;
}) {
  const router = useRouter();
  const performReviewAction = useAction(api.missions_node.performReviewAction);

  const [activeAction, setActiveAction] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [inputValues, setInputValues] = useState<Record<string, string>>({});

  // Find the action that matches the current mission status, excluding reject
  // (which has its own expand-on-click affordance in RejectSection).
  const eligibleAction = actions.find(
    (a) => a.requiredStatus === status && a.key !== "reject" && a.enabled,
  );
  if (!eligibleAction) return null;

  async function handleAction(action: ReviewActionDescriptor) {
    setActiveAction(action.key);
    setActionError(null);
    try {
      await performReviewAction({
        missionId: missionId as Id<"missions">,
        actionKey: action.key,
        ...(Object.keys(inputValues).length > 0 ? { input: inputValues } : {}),
      });
      router.push(`/projects/${encodeURIComponent(instanceId)}/missions`);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "An error occurred");
      setActiveAction(null);
    }
  }

  const isLoading = activeAction !== null;

  return (
    <section className="grid gap-3">
      {actionError && (
        <p className="text-[0.88rem] text-red-700">{actionError}</p>
      )}

      {/* Render declared input fields */}
      {(eligibleAction.inputs ?? []).map((inputDef) => (
        <div key={inputDef.key} className="grid gap-2">
          <label
            htmlFor={`action-input-${inputDef.key}`}
            className="text-[0.8rem] font-semibold uppercase tracking-[0.14em] text-[var(--dashboard-ink-soft)]"
          >
            {inputDef.label}
            {!inputDef.required && (
              <span className="ml-1 normal-case font-normal text-[var(--dashboard-ink-muted)]">
                (optional)
              </span>
            )}
          </label>
          <input
            id={`action-input-${inputDef.key}`}
            type={inputDef.type}
            value={inputValues[inputDef.key] ?? ""}
            onChange={(e) =>
              setInputValues((prev) => ({ ...prev, [inputDef.key]: e.target.value }))
            }
            disabled={isLoading}
            data-testid={`action-input-${inputDef.key}`}
            className="w-full max-w-xs rounded-2xl border border-[rgba(0,38,27,0.12)] bg-white px-4 py-2 text-[0.92rem] text-[var(--dashboard-ink)] disabled:opacity-40"
          />
        </div>
      ))}

      <div className="flex gap-4">
        <button
          type="button"
          onClick={() => { void handleAction(eligibleAction); }}
          disabled={isLoading || disabled}
          data-testid={`review-action-${eligibleAction.key}`}
          className="inline-flex min-h-[3rem] items-center justify-center gap-3 rounded-2xl border border-[var(--dashboard-primary)] bg-[var(--dashboard-primary)] px-5 font-semibold text-[var(--dashboard-on-primary)] shadow-[0_14px_26px_rgba(0,38,27,0.24)] transition hover:bg-[var(--dashboard-primary-container)] disabled:cursor-not-allowed disabled:opacity-40"
        >
          {isLoading ? `${eligibleAction.label}…` : eligibleAction.label}
        </button>
      </div>
      {disabled && (
        <p data-testid="review-action-blocked" className="m-0 text-[0.82rem] text-[var(--dashboard-ink-muted)]">
          This action is unavailable until the review content is complete.
        </p>
      )}
    </section>
  );
}

/**
 * Generic reject affordance driven by the Template's declared `reject` capability
 * (ADR-020). Renders an expand-on-click feedback textarea and calls
 * `performReviewAction` with `actionKey: "reject"` and the feedback as input.
 *
 * Replaces the legacy `RejectArticleSection` and `RejectVideoSection` — both
 * SEO and video rejection flows are handled through the same generic action.
 */
function RejectSection({
  missionId,
  instanceId,
  rejectCapability,
}: {
  missionId: string;
  instanceId: string;
  /** The Template-declared `reject` action capability. */
  rejectCapability: ReviewActionDescriptor;
}) {
  const router = useRouter();
  const performReviewAction = useAction(api.missions_node.performReviewAction);

  const [rejecting, setRejecting] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [rejectError, setRejectError] = useState<string | null>(null);

  // Find the feedback input definition from the capability (typically key "feedback").
  const feedbackInputDef = rejectCapability.inputs.find((i) => i.key === "feedback")
    ?? rejectCapability.inputs[0];

  const feedbackKey = feedbackInputDef?.key ?? "feedback";
  const feedbackLabel = feedbackInputDef?.label ?? "Review Feedback";

  async function handleReject() {
    const trimmed = feedback.trim();
    if (!trimmed) {
      setRejectError("Feedback is required.");
      return;
    }
    setSubmitting(true);
    setRejectError(null);
    try {
      await performReviewAction({
        missionId: missionId as Id<"missions">,
        actionKey: "reject",
        input: { [feedbackKey]: trimmed },
      });
      router.push(`/projects/${encodeURIComponent(instanceId)}/missions`);
    } catch (err) {
      setRejectError(err instanceof Error ? err.message : "An error occurred");
      setSubmitting(false);
    }
  }

  if (!rejecting) {
    return (
      <button
        type="button"
        onClick={() => { setRejecting(true); }}
        data-testid="reject-button"
        className="inline-flex min-h-[3rem] items-center justify-center gap-3 rounded-2xl border border-red-700 bg-white px-5 font-semibold text-red-700 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {rejectCapability.label}
      </button>
    );
  }

  return (
    <div className="grid gap-3">
      {rejectError && (
        <p className="text-[0.88rem] text-red-700">{rejectError}</p>
      )}
      <label
        htmlFor="reject-feedback"
        className="text-[0.8rem] font-semibold uppercase tracking-[0.14em] text-[var(--dashboard-ink-soft)]"
      >
        {feedbackLabel}
      </label>
      <textarea
        id="reject-feedback"
        value={feedback}
        onChange={(e) => setFeedback(e.target.value)}
        rows={4}
        placeholder="Explain what needs to be corrected…"
        disabled={submitting}
        data-testid="reject-feedback"
        className="w-full rounded-2xl border border-[rgba(0,38,27,0.12)] bg-white p-4 text-[0.92rem] text-[var(--dashboard-ink)] disabled:opacity-40"
      />
      <div className="flex gap-4">
        <button
          type="button"
          onClick={() => { void handleReject(); }}
          disabled={submitting || feedback.trim() === ""}
          data-testid="reject-confirm"
          className="inline-flex min-h-[3rem] items-center justify-center gap-3 rounded-2xl border border-red-700 bg-red-700 px-5 font-semibold text-white shadow-[0_14px_26px_rgba(185,28,28,0.20)] transition hover:bg-red-800 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {submitting ? "Submitting…" : "Confirm rejection"}
        </button>
        <button
          type="button"
          onClick={() => { setRejecting(false); setRejectError(null); }}
          disabled={submitting}
          data-testid="reject-cancel"
          className="inline-flex min-h-[3rem] items-center justify-center gap-3 rounded-2xl border border-[rgba(0,38,27,0.12)] bg-white px-5 font-semibold text-[var(--dashboard-ink)] disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

export function MissionReviewContent({
  instanceId,
  missionId,
  readOnly = false,
}: {
  instanceId: string;
  missionId: string;
  readOnly?: boolean;
}) {
  const router = useRouter();
  const mission = useQuery(api.missions.get, { missionId: missionId as Id<"missions"> });
  const getReview = useAction(api.missions_node.getReview);
  const loadReviewContent = useAction(api.missions_node.loadReviewContent);

  const [reviewContent, setReviewContent] = useState<string | null>(null);
  const [reviewKind, setReviewKind] = useState<string | null>(null);
  const [reviewCoverUrl, setReviewCoverUrl] = useState<string | null>(null);
  const [reviewProjection, setReviewProjection] = useState<{
    status: string;
    reviewable: boolean;
    artifact: {
      available: boolean;
      kind?: "markdown" | "metadata" | "image" | "video";
      externalId?: string;
      metadata: Record<string, string | number | boolean>;
    };
    content: {
      kind: "markdown" | "metadata" | "image" | "video";
      source: "workspace" | "external";
      available: boolean;
      error?: string;
    } | null;
    actions: ReviewActionDescriptor[];
    errors: string[];
  } | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [loadingContent, setLoadingContent] = useState(false);

  // Suppress unused variable warning — router is used in sub-components
  void router;

  const additionalDetails =
    mission?.lastResult && "additionalDetails" in mission.lastResult
      ? mission.lastResult.additionalDetails
      : undefined;

  useEffect(() => {
    if (!mission) return;
    let cancelled = false;
    setReviewContent(null);
    setReviewKind(null);
    setReviewCoverUrl(null);
    setReviewProjection(null);
    setFetchError(null);
    void getReview({ missionId: missionId as Id<"missions"> })
      .then((projection) => {
        if (!cancelled) setReviewProjection(projection);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setFetchError(err instanceof Error ? err.message : "Failed to load review");
        }
      });
    return () => { cancelled = true; };
  }, [getReview, mission?._id, mission?.status, missionId]);

  useEffect(() => {
    if (
      reviewContent ||
      loadingContent ||
      fetchError ||
      !mission ||
      !reviewProjection?.artifact.available ||
      !reviewProjection.content?.available
    ) {
      return;
    }
    setLoadingContent(true);
    void (async () => {
      try {
        const result = await loadReviewContent({ missionId: missionId as Id<"missions"> });
        setReviewContent(result.content);
        setReviewKind(result.kind);
        setReviewCoverUrl(result.coverUrl ?? null);
        setFetchError(null);
      } catch (err) {
        setFetchError(err instanceof Error ? err.message : "Failed to load content");
      } finally {
        setLoadingContent(false);
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  // loadReviewContent is intentionally omitted: useAction returns a stable ref
  }, [
    missionId,
    mission?._id,
    reviewProjection?.artifact.externalId,
    reviewProjection?.content?.available,
  ]);

  if (mission === undefined) {
    return (
      <div className="grid gap-8">
        <p className="text-[0.92rem] text-[var(--dashboard-ink-muted)]">Loading…</p>
      </div>
    );
  }

  if (mission === null) {
    return (
      <div className="grid gap-8">
        <p className="text-[0.92rem] text-[var(--dashboard-ink-muted)]">Mission not found.</p>
      </div>
    );
  }

  if (reviewProjection === null) {
    return (
      <div className="grid gap-8">
        <p className="text-[0.92rem] text-[var(--dashboard-ink-muted)]">
          {fetchError ?? "Loading review…"}
        </p>
      </div>
    );
  }

  const reviewArtifact = reviewProjection?.artifact;
  const reviewContract = reviewProjection?.content;
  const reviewKindFromContract = reviewContract?.kind ?? reviewArtifact?.kind;
  const isVideoMission = reviewKindFromContract === "video";
  const isCarouselMission = reviewKindFromContract === "image";
  const isWorkspaceArtifact = reviewContract?.source === "workspace";
  const isSocialEngagement = reviewKindFromContract === "metadata" && isWorkspaceArtifact;
  const isReviewable = reviewProjection?.reviewable ?? false;
  const metadata = reviewArtifact?.metadata;
  const carouselReview =
    isCarouselMission && reviewKind === "image" && reviewContent
      ? parseCarouselReviewPayload(reviewContent)
      : null;
  const carouselReviewBlocked =
    isCarouselMission &&
    (reviewContent === null || reviewKind !== "image" || carouselReview === null || carouselReview.missingImages.length > 0);

  const reviewActions = reviewProjection?.actions ?? [];

  // Extract the reject capability for use by the dedicated RejectSection.
  const rejectCapability = reviewActions.find(
    (a) => a.key === "reject" && a.requiredStatus === mission.status && a.enabled,
  );

  return (
    <div className="grid gap-8">
      <header className="grid gap-1">
        <Link
          href={`/projects/${encodeURIComponent(instanceId)}/missions`}
          className="text-[0.75rem] font-bold uppercase tracking-[0.18em] text-[var(--dashboard-ink-soft)] hover:text-[var(--dashboard-primary)]"
        >
          ← Missions
        </Link>
        <h1 className="m-0 text-[clamp(1.6rem,3vw,2.5rem)] font-extrabold leading-[0.98] tracking-[-0.04em] text-[var(--dashboard-ink)]">
          {isSocialEngagement
            ? "Engagement Report"
            : readOnly
              ? isVideoMission ? "Video View" : isCarouselMission ? "Carousel View" : "Article View"
              : isVideoMission ? "Video Review" : isCarouselMission ? "Carousel Review" : "Article Review"}
        </h1>
      </header>

      {!reviewArtifact?.available ? (
        <section className="rounded-[1.75rem] border border-[rgba(0,38,27,0.08)] bg-[#f8f9f7] p-6">
          <p className="text-[0.92rem] text-[var(--dashboard-ink-muted)]">No artifact available for this mission.</p>
        </section>
      ) : (
        <>
          {!isVideoMission && !isCarouselMission && !isWorkspaceArtifact && <IndexingBadge indexing={mission.indexing} />}

          {!isVideoMission && !isCarouselMission && !isWorkspaceArtifact && (
            <section className="grid gap-4 rounded-[1.75rem] border border-[rgba(0,38,27,0.08)] bg-[#f8f9f7] p-6 shadow-[0_18px_34px_rgba(25,28,28,0.06)]">
              <h2 className="m-0 text-[0.9rem] font-bold uppercase tracking-[0.14em] text-[var(--dashboard-ink-soft)]">
                SEO Metadata
              </h2>
              <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-[0.92rem]">
                {metadata?.["keyword"] !== undefined && (
                  <>
                    <dt className="font-semibold text-[var(--dashboard-ink-soft)]">Keyword</dt>
                    <dd className="text-[var(--dashboard-ink)]">{String(metadata["keyword"])}</dd>
                  </>
                )}
                {reviewArtifact?.externalId !== undefined && (
                  <>
                    <dt className="font-semibold text-[var(--dashboard-ink-soft)]">Article ID</dt>
                    <dd className="font-mono text-[var(--dashboard-ink)]">{String(reviewArtifact.externalId)}</dd>
                  </>
                )}
                {metadata?.["score"] !== undefined && (
                  <>
                    <dt className="font-semibold text-[var(--dashboard-ink-soft)]">Score</dt>
                    <dd className="text-[var(--dashboard-ink)]">{String(metadata["score"])}</dd>
                  </>
                )}
              </dl>
            </section>
          )}

          {reviewCoverUrl && !isVideoMission && !isCarouselMission && !isWorkspaceArtifact && (
            <ReviewCover src={reviewCoverUrl} />
          )}

          {/* Generic content renderer — switches on kind returned by loadReviewContent */}
          <section className="grid gap-4 rounded-[1.75rem] border border-[rgba(0,38,27,0.08)] bg-[#f8f9f7] p-6 shadow-[0_18px_34px_rgba(25,28,28,0.06)]">
            {!isSocialEngagement && (
              <h2 className="m-0 text-[0.9rem] font-bold uppercase tracking-[0.14em] text-[var(--dashboard-ink-soft)]">
                {isVideoMission ? "Final Video" : isCarouselMission ? "Carousel images" : "Article"}
              </h2>
            )}
            {fetchError ? (
              <p className="text-[0.88rem] text-red-700">{fetchError}</p>
            ) : reviewContent ? (
              reviewKind === "video" ? (
                <video
                  controls
                  src={reviewContent}
                  className="w-full rounded-xl"
                  data-testid="review-video"
                />
              ) : reviewKind === "image" && isCarouselMission ? (
                <CarouselReviewContent content={reviewContent} />
              ) : reviewKind === "metadata" && isSocialEngagement && isSocialEngagementReport((() => { try { return JSON.parse(reviewContent); } catch { return null; } })()) ? (
                <SocialEngagementReport
                  content={reviewContent}
                  additionalDetails={additionalDetails}
                />
              ) : reviewKind === "markdown" || reviewKind === null ? (
                <WorkspaceMarkdown content={reviewContent} />
              ) : (
                <p className="text-[0.88rem] text-[var(--dashboard-ink-muted)]">
                  Unsupported content type: {reviewKind}
                </p>
              )
            ) : (
              <p className="text-[0.92rem] text-[var(--dashboard-ink-muted)]">
                {isVideoMission ? "Loading video…" : isCarouselMission ? "Loading carousel images…" : isSocialEngagement ? "Loading engagement report…" : "Loading article…"}
              </p>
            )}
          </section>

          {/* Generic review action panel + generic reject affordance (ADR-020) */}
          {!readOnly && isReviewable && (
            <section className="grid gap-3">
              <div className="flex flex-wrap gap-4 items-center">
                <ReviewActionsSection
                  missionId={missionId}
                  instanceId={instanceId}
                  status={mission.status}
                actions={reviewActions}
                  disabled={carouselReviewBlocked}
                />
                {/* Reject is only available from to_validate, not after approval */}
                {rejectCapability && (
                  <RejectSection
                    missionId={missionId}
                    instanceId={instanceId}
                    rejectCapability={rejectCapability}
                  />
                )}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
