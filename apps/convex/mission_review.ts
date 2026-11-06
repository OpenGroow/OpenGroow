"use node";

import {
  resolveReviewContract,
  type AgentManifest,
  type ReviewActionCapability,
  type ReviewContentContract,
} from "@opengroow/agent-templates";
import type { PublicationStatus } from "./publisher_schema.js";

export type ReviewContentKind = "markdown" | "metadata" | "image" | "video";

export type MissionReviewActionInput = {
  key: string;
  label: string;
  type: "text" | "datetime-local";
  required: boolean;
};

export type MissionReviewAction = {
  key: ReviewActionCapability["key"];
  label: string;
  requiredStatus: ReviewActionCapability["requiredStatus"];
  inputs: MissionReviewActionInput[];
  enabled: boolean;
  disabledReason?: string;
};

export type MissionReviewProjection = {
  status: string;
  reviewable: boolean;
  artifact: {
    available: boolean;
    kind?: ReviewContentKind;
    externalId?: string;
    metadata: Record<string, string | number | boolean>;
  };
  content: {
    kind: ReviewContentKind;
    source: "workspace" | "external";
    available: boolean;
    error?: string;
  } | null;
  actions: MissionReviewAction[];
  defaultActionKey?: ReviewActionCapability["key"];
  /** Present only when the Mission type declares `publish`. */
  publish?: MissionPublishProjection;
  errors: string[];
};

export type MissionReviewSnapshot = {
  status: string;
  missionType: string;
  lastResult?: unknown;
};

/** Where a Mission goes and what happened so far (ADR-069); only for Mission
 * types that declare `publish`. */
export type MissionPublishProjection = {
  target: string | null;
  /** Every target the Mission goes to (one Publication each). */
  targets: string[];
  /** Every target is mapped to a channel on the Project's Publisher. */
  mapped: boolean;
  /** The targets that have no channel yet (empty when `mapped`). */
  unmappedTargets: string[];
  /** The Project has a Publisher with an API key. Without it nothing can be sent. */
  publisherReady: boolean;
  /** The date the human chose (epoch ms); absent = publish immediately. */
  publishAt?: number;
  publications: Array<{
    target: string;
    status: PublicationStatus;
    externalId?: string;
    externalUrl?: string;
    scheduledAt?: number;
    error?: string;
  }>;
};

type ArtifactSnapshot = {
  kind?: ReviewContentKind;
  external?: { service?: string; id?: string };
  metadata?: Record<string, string | number | boolean>;
};

function objectRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function currentArtifact(lastResult: unknown): ArtifactSnapshot | undefined {
  const result = objectRecord(lastResult);
  const artifact = objectRecord(result?.artifact);
  if (!artifact) return undefined;

  const metadata = objectRecord(artifact.metadata);
  const safeMetadata: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(metadata ?? {})) {
    if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      safeMetadata[key] = value;
    }
  }

  return {
    kind:
      artifact.kind === "markdown" ||
      artifact.kind === "metadata" ||
      artifact.kind === "image" ||
      artifact.kind === "video"
        ? artifact.kind
        : undefined,
    external: objectRecord(artifact.external)
      ? {
          service:
            typeof objectRecord(artifact.external)?.service === "string"
              ? (objectRecord(artifact.external)?.service as string)
              : undefined,
          id:
            typeof objectRecord(artifact.external)?.id === "string"
              ? (objectRecord(artifact.external)?.id as string)
              : undefined,
        }
      : undefined,
    metadata: safeMetadata,
  };
}

function safeInputs(action: ReviewActionCapability): MissionReviewActionInput[] {
  return (action.inputs ?? []).map((input) => ({
    key: input.key,
    label: input.label,
    type: input.type,
    required: input.required,
  }));
}

function contentSource(
  artifact: ArtifactSnapshot | undefined,
  contract: ReviewContentContract | undefined,
): "workspace" | "external" | null {
  if (artifact?.external?.service === "workspace") return "workspace";
  if (contract && "server" in contract) return "external";
  return null;
}

function contentError(
  artifact: ArtifactSnapshot | undefined,
  contract: ReviewContentContract | undefined,
): string | undefined {
  if (!artifact) return "No artifact available for this mission";
  if (!artifact.external?.id) {
    return "Artifact has no external identifier";
  }
  if (!contract && artifact.external.service !== "workspace") {
    return "Mission type does not declare a review contract";
  }
  if (
    contract &&
    "service" in contract &&
    artifact.external.service !== "workspace"
  ) {
    return "Review contract expects a workspace artifact";
  }
  if (
    contract &&
    "server" in contract &&
    artifact.external.service === "workspace"
  ) {
    return "Review contract expects an external artifact";
  }
  return undefined;
}

function actionEnabled(
  action: ReviewActionCapability,
  snapshot: MissionReviewSnapshot,
  artifact: ArtifactSnapshot | undefined,
): { enabled: boolean; disabledReason?: string } {
  if (snapshot.status !== action.requiredStatus) {
    return {
      enabled: false,
      disabledReason: `Requires mission status \"${action.requiredStatus}\"`,
    };
  }

  const isRevisionRun =
    action.effect && "kind" in action.effect && action.effect.kind === "revision_run";
  if (!artifact && !isRevisionRun) {
    return { enabled: false, disabledReason: "No artifact available for this mission" };
  }
  return { enabled: true };
}

function publishBlockedReason(publish: MissionPublishProjection): string | undefined {
  if (!publish.publisherReady) {
    return "The Publisher has no API key (or none is set up): configure it on the Publishers page";
  }
  if (publish.targets.length === 0) {
    return "Choose a channel";
  }
  if (publish.unmappedTargets.length > 0) {
    const names = publish.unmappedTargets.map((t) => `"${t}"`).join(", ");
    return `Channel ${names} is not on the Project's Publisher (or not configured): check the Publishers page`;
  }
  return undefined;
}

export function buildMissionReviewProjection(
  manifest: AgentManifest | undefined,
  snapshot: MissionReviewSnapshot,
  publish?: MissionPublishProjection,
): MissionReviewProjection {
  const artifact = currentArtifact(snapshot.lastResult);
  const contract = manifest
    ? resolveReviewContract(manifest, snapshot.missionType)
    : undefined;
  const errors: string[] = [];

  if (!manifest) errors.push("Template not found");
  if (!contract && artifact?.external?.service !== "workspace") {
    errors.push("Mission type does not declare a review contract");
  }

  // A Mission type that declares `publish` is reviewed from its `publishable`
  // (references to public media), never from a review.path HTTP route: the
  // content is not fetched, so its contract is not checked either (#26).
  const publishDriven = publish !== undefined;
  const artifactError = publishDriven
    ? artifact ? undefined : "No artifact available for this mission"
    : contentError(artifact, contract);
  if (artifactError && !errors.includes(artifactError)) errors.push(artifactError);

  const source = contentSource(artifact, contract);
  const content =
    artifact && source && !publishDriven
      ? {
          kind: contract?.kind ?? artifact.kind ?? "metadata",
          source,
          available: !artifactError,
          ...(artifactError ? { error: artifactError } : {}),
        }
      : null;

  const declaredActions = contract?.actions ?? [];
  const actions = declaredActions.map((action) => {
    let availability = actionEnabled(action, snapshot, artifact);
    // A Publisher that cannot send (no API key) or an unmapped target blocks `publish`.
    if (publish && action.key === "publish" && availability.enabled) {
      const blocked = publishBlockedReason(publish);
      if (blocked) availability = { enabled: false, disabledReason: blocked };
    }
    return {
      key: action.key,
      label: action.label,
      requiredStatus: action.requiredStatus,
      inputs: safeInputs(action),
      ...availability,
    };
  });

  return {
    status: snapshot.status,
    reviewable: snapshot.status === "to_validate" || snapshot.status === "approved",
    artifact: {
      available: artifact !== undefined,
      kind: artifact?.kind,
      externalId: artifact?.external?.id,
      metadata: artifact?.metadata ?? {},
    },
    content,
    actions,
    defaultActionKey: actions.find((action) => action.enabled)?.key,
    ...(publish ? { publish } : {}),
    errors,
  };
}

