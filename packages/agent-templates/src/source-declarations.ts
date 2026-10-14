/**
 * Manifest validation for Template-declared Sources (issue #528, ADR-051).
 * Pure functions over raw manifest data — no filesystem access. The existence
 * of each instruction file on disk is checked where files are read (codegen,
 * `loadTemplate`) and at workspace provisioning.
 */

function isPlainObject(raw: unknown): raw is Record<string, unknown> {
  return !!raw && typeof raw === "object" && !Array.isArray(raw);
}

/** Shape check of the polling core shared by Mission and Source external jobs. */
export function isValidExternalJobPollingCore(raw: unknown): boolean {
  if (!isPlainObject(raw)) return false;
  if (typeof raw.server !== "string" || typeof raw.mcpTool !== "string" || typeof raw.statusField !== "string") {
    return false;
  }
  if (raw.outputIsRoot !== undefined && typeof raw.outputIsRoot !== "boolean") return false;
  const ts = raw.terminalStates;
  if (!isPlainObject(ts)) return false;
  const isStringArray = (v: unknown) => Array.isArray(v) && v.every((s) => typeof s === "string");
  return isStringArray(ts.completed) && isStringArray(ts.failed);
}

/**
 * Strict allow-list of the JSON Schema keywords the validator (Convex) AND the
 * dashboard rendering both support. Anything else is rejected with its path.
 * `items` must be a single subschema (no tuple form) and `additionalProperties`
 * a boolean.
 */
const ALLOWED_KEYWORDS = new Set([
  "type",
  "properties",
  "required",
  "items",
  "enum",
  "format",
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "minLength",
  "maxLength",
  "minItems",
  "maxItems",
  "pattern",
  "additionalProperties",
  "title",
  "description",
  "default",
  "const",
]);

/**
 * Walk a JSON Schema and return a message for the first keyword outside the
 * allow-list, or undefined when the schema stays within it. Only real
 * subschema positions (`properties` values, `items`) are visited, so a
 * property *named* `not` is fine.
 */
export function findUnsupportedSchemaKeyword(schema: unknown, path = "$"): string | undefined {
  if (!isPlainObject(schema)) return undefined;
  for (const keyword of Object.keys(schema)) {
    if (!ALLOWED_KEYWORDS.has(keyword)) return `uses unsupported keyword "${keyword}" at ${path}`;
  }
  const join = (segment: string) => (path === "$" ? segment : `${path}.${segment}`);
  if (schema.additionalProperties !== undefined && typeof schema.additionalProperties !== "boolean") {
    return `uses non-boolean "additionalProperties" at ${join("additionalProperties")} — only true/false is supported`;
  }
  if (schema.items !== undefined) {
    if (!isPlainObject(schema.items)) {
      return `uses unsupported "items" at ${join("items")} — it must be a single schema object (no tuple form)`;
    }
    const found = findUnsupportedSchemaKeyword(schema.items, join("items"));
    if (found) return found;
  }
  if (isPlainObject(schema.properties)) {
    for (const [name, sub] of Object.entries(schema.properties)) {
      const found = findUnsupportedSchemaKeyword(sub, join(`properties.${name}`));
      if (found) return found;
    }
  }
  return undefined;
}

function isNonEmptyString(raw: unknown): raw is string {
  return typeof raw === "string" && raw.length > 0;
}

/**
 * Validate `sources` and `externalJobsBySource`. Returns an actionable reason,
 * or undefined when both are absent or valid. `missionAgentsMd` maps each
 * Mission type's `agentsMd` path to its type: every `agentsMd` of the Template
 * (Mission types and Sources) must be unique.
 */
export function validateSourceDeclarations(
  manifest: Record<string, unknown>,
  declaredServers: Set<string>,
  isSafeInstructionPath: (raw: unknown) => boolean,
  missionAgentsMd: Map<string, string> = new Map(),
): string | undefined {
  const sourceIds = new Set<string>();
  if (manifest.sources !== undefined) {
    if (!Array.isArray(manifest.sources)) return "'sources' must be an array";
    const agentsMdOwners = new Map<string, string>();
    for (const [index, entry] of (manifest.sources as unknown[]).entries()) {
      if (!isPlainObject(entry)) return `sources[${index}] must be an object`;
      if (!isNonEmptyString(entry.type)) return `sources[${index}] is missing a non-empty 'type'`;
      const type = entry.type;
      const at = `sources[${JSON.stringify(type)}]`;
      if (!isNonEmptyString(entry.label)) return `${at} is missing a non-empty 'label'`;
      if (!isNonEmptyString(entry.family)) return `${at} is missing a non-empty 'family' (free text)`;
      if (sourceIds.has(type)) return `sources contains duplicate Source type ${JSON.stringify(type)} — every Source type must be unique`;
      sourceIds.add(type);
      if (!isSafeInstructionPath(entry.agentsMd)) {
        return `${at}.agentsMd must be a safe relative .md path (no leading "/", ".." or reserved workspace files)`;
      }
      const file = entry.agentsMd as string;
      const missionOwner = missionAgentsMd.get(file);
      if (missionOwner !== undefined) {
        return `${at}.agentsMd ${JSON.stringify(file)} is already used by mission type ${JSON.stringify(missionOwner)} — every agentsMd of the Template must be unique`;
      }
      const sourceOwner = agentsMdOwners.get(file);
      if (sourceOwner !== undefined) {
        return `${at}.agentsMd ${JSON.stringify(file)} is already used by Source ${JSON.stringify(sourceOwner)} — every agentsMd of the Template must be unique`;
      }
      agentsMdOwners.set(file, type);
      const schema = entry.analysisSchema;
      if (!isPlainObject(schema) || schema.type !== "object") {
        return `${at}.analysisSchema must be a JSON Schema object with type "object"`;
      }
      const unsupported = findUnsupportedSchemaKeyword(schema);
      if (unsupported) return `${at}.analysisSchema ${unsupported}`;
    }
  }

  if (manifest.externalJobsBySource !== undefined) {
    if (!isPlainObject(manifest.externalJobsBySource)) {
      return "externalJobsBySource must be an object mapping Source types to a map of job type to polling contract";
    }
    for (const [sourceId, jobs] of Object.entries(manifest.externalJobsBySource)) {
      if (!sourceIds.has(sourceId)) {
        return `externalJobsBySource references unknown Source "${sourceId}" — declare it in sources`;
      }
      if (!isPlainObject(jobs)) {
        return `externalJobsBySource["${sourceId}"] must be an object mapping job type strings to polling contracts`;
      }
      for (const [jobType, contract] of Object.entries(jobs)) {
        const codes = isPlainObject(contract) ? contract.unavailableErrorCodes : undefined;
        if (codes !== undefined && !(Array.isArray(codes) && codes.every((c) => typeof c === "string"))) {
          return `externalJobsBySource["${sourceId}"]["${jobType}"].unavailableErrorCodes must be an array of strings`;
        }
        if (!isValidExternalJobPollingCore(contract)) {
          return `externalJobsBySource["${sourceId}"]["${jobType}"] is malformed — required fields: server (string), mcpTool (string), statusField (string), terminalStates.completed (string[]), terminalStates.failed (string[])`;
        }
        const server = (contract as Record<string, unknown>).server as string;
        if (!declaredServers.has(server)) {
          return `externalJobsBySource["${sourceId}"]["${jobType}"].server "${server}" is not declared in this Agent Template's mcpServers`;
        }
      }
    }
  }
  return undefined;
}
