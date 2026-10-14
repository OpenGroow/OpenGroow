"use node";

import {
  resolveReviewContract,
  type AgentManifest,
  type ReviewActionCapability,
  type ReviewContentContract,
} from "@opengroow/agent-templates";

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
  errors: string[];
};

export type MissionReviewSnapshot = {
  status: string;
  missionType: string;
  lastResult?: unknown;
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

export function buildMissionReviewProjection(
  manifest: AgentManifest | undefined,
  snapshot: MissionReviewSnapshot,
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

  const artifactError = contentError(artifact, contract);
  if (artifactError && !errors.includes(artifactError)) errors.push(artifactError);

  const source = contentSource(artifact, contract);
  const content =
    artifact && source
      ? {
          kind: contract?.kind ?? artifact.kind ?? "metadata",
          source,
          available: !artifactError,
          ...(artifactError ? { error: artifactError } : {}),
        }
      : null;

  const declaredActions = contract?.actions ?? [];
  const actions = declaredActions.map((action) => {
    const availability = actionEnabled(action, snapshot, artifact);
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
    errors,
  };
}

