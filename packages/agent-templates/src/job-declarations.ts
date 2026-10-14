const JOB_TYPE_NAMES = ["source_ingestion", "source_scoring", "source_routing"] as const;
type JobTypeName = string;

export function isPlainObject(raw: unknown): raw is Record<string, unknown> {
  return !!raw && typeof raw === "object" && !Array.isArray(raw);
}

function isNonEmptyString(raw: unknown): raw is string {
  return typeof raw === "string" && raw.length > 0;
}

function isJobTypeName(raw: unknown): raw is JobTypeName {
  return isNonEmptyString(raw);
}

/** Validate explicit executable Job capabilities in an Agent manifest. */
export function validateJobTypeDeclarations(
  manifest: Record<string, unknown>,
  isSafeInstructionPath: (raw: unknown) => boolean,
  instructionOwners: Map<string, string>,
): string | undefined {
  if (manifest.jobTypes === undefined) return undefined;
  if (!Array.isArray(manifest.jobTypes)) return "'jobTypes' must be an array";

  const sourceTypes = new Set(
    (Array.isArray(manifest.sources) ? manifest.sources : [])
      .filter(isPlainObject)
      .map((source) => source.type)
      .filter(isNonEmptyString),
  );
  const seen = new Set<string>();

  for (const [index, raw] of manifest.jobTypes.entries()) {
    if (!isPlainObject(raw)) return `jobTypes[${index}] must be an object`;
    if (!isJobTypeName(raw.type)) return `jobTypes[${index}].type must be a non-empty string`;
    const type = raw.type;
    if (seen.has(type)) return `jobTypes contains duplicate Job type ${JSON.stringify(type)} — every Job type must be unique`;
    seen.add(type);

    const sourceTypesValue = raw.sourceTypes;
    if (type === "source_ingestion") {
      if (!Array.isArray(sourceTypesValue) || sourceTypesValue.length === 0 || !sourceTypesValue.every(isNonEmptyString)) {
        return `jobTypes[${JSON.stringify(type)}].sourceTypes must be a non-empty array of Source type strings`;
      }
      const referenced = new Set<string>();
      for (const sourceType of sourceTypesValue) {
        if (referenced.has(sourceType)) {
          return `jobTypes[${JSON.stringify(type)}].sourceTypes contains duplicate Source type ${JSON.stringify(sourceType)}`;
        }
        referenced.add(sourceType);
        if (!sourceTypes.has(sourceType)) {
          return `jobTypes[${JSON.stringify(type)}].sourceTypes references unknown Source type ${JSON.stringify(sourceType)} — declare it in sources`;
        }
      }
    } else if (sourceTypesValue !== undefined) {
      return `jobTypes[${JSON.stringify(type)}].sourceTypes is only valid for source_ingestion`;
    }

    if (type === "source_ingestion" && raw.agentsMd === undefined) continue;
    if (!isSafeInstructionPath(raw.agentsMd)) {
      return `jobTypes[${JSON.stringify(type)}].agentsMd must be a safe relative .md path`;
    }
    const path = raw.agentsMd as string;
    const owner = instructionOwners.get(path);
    if (owner !== undefined) {
      return `jobTypes[${JSON.stringify(type)}].agentsMd ${JSON.stringify(path)} is already used by ${owner}`;
    }
    instructionOwners.set(path, `Job type ${JSON.stringify(type)}`);
  }

  return undefined;
}

export type { JobTypeName };
export { JOB_TYPE_NAMES };
