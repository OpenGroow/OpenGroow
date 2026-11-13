/**
 * Manifest validation for a Mission type's `publish` declaration (issue #16,
 * ADR-069). Pure function over raw manifest data.
 */

import { isKnownPlatform, PLATFORM_IDS } from "@opengroow/publisher-sdk";

/** The closed set of Publishable kinds (V1). A new kind is a product change:
 * add it here and to the Publishable schema in `apps/convex/publishable.ts`
 * (a test pins both lists together). */
export const PUBLISHABLE_KINDS = ["video", "image", "carousel", "article"] as const;
export type PublishableKind = (typeof PUBLISHABLE_KINDS)[number];

/** The optional fields of each kind that a Template may guarantee through
 * `publish.require` (a test pins this against the Publishable zod schema in
 * `apps/convex/publishable.ts`). `metadata` is free-form and cannot be required. */
export const OPTIONAL_PUBLISHABLE_FIELDS = {
  video: ["coverUrl", "title", "link", "tags"],
  image: ["variants", "link", "altText"],
  carousel: ["variants", "link", "altText"],
  article: ["category"],
} as const satisfies Record<PublishableKind, readonly string[]>;

/** The kinds whose whole Publishable belongs to the MCP (ADR-074): it comes
 * from `publish.resource`, the Agent writes none of it. A rule of the kind,
 * not a manifest option. */
export const MCP_OWNED_PUBLISHABLE_KINDS = ["article"] as const satisfies readonly PublishableKind[];

export function isMcpOwnedKind(kind: string): boolean {
  return (MCP_OWNED_PUBLISHABLE_KINDS as readonly string[]).includes(kind);
}

/** The fields of each kind `publish.resource` fetches and `publish.resource.map`
 * may map: the media, or every field of a kind the MCP owns. The Agent never
 * writes them. */
export const RESOURCE_PUBLISHABLE_FIELDS = {
  video: ["videoUrl", "coverUrl"],
  image: ["imageUrl", "variants"],
  carousel: ["slideUrls", "variants"],
  article: ["markdownUrl", "coverUrl", "slug", "title", "description", "category", "metadata"],
} as const satisfies Record<PublishableKind, readonly string[]>;

// A path in the MCP tool output: dot-separated keys, each optionally followed
// by `[n]` or `[*]` (every item of an array).
const MEDIA_PATH_SEGMENT = /^[A-Za-z_][\w-]*(\[(\*|\d+)\])*$/;

/** What a Mission type declares: the kind it produces and, optionally, the
 * platforms it can go to. The channels are chosen per Mission or Schedule
 * among the Publisher's channels (ADR-069).
 * `require` lists optional fields of the kind that the Template guarantees: it
 * can only tighten the Publishable, never loosen it. */
export type PublishDeclaration = {
  kind: PublishableKind;
  require?: string[];
  /**
   * The platforms the content can go to (ADR-073), among `PLATFORM_IDS` of the
   * Publisher SDK: a channel on another platform is refused, and the channel
   * picker disables it. Absent: every channel. A channel's own platform or its
   * family matches (`instagram` covers `instagram-standalone`).
   */
  platforms?: string[];
  /**
   * For an asynchronous MCP (launch, poll, then fetch): the MCP tool OpenGroow
   * calls once when the External Job completes, to get the media (ADR-069
   * amendment). The Agent only writes the text part of the `publishable` in its
   * `in_progress` RunResult; the media returned by the tool is merged into it.
   */
  resource?: PublishResource;
  /**
   * Called once when a Publication of the Mission becomes `published`, so the
   * producing service can follow up (ADR-074, issue #62). Never blocking: a
   * failure leaves the Mission `done` with a warning and a resend button, so
   * the receiving endpoint must be idempotent.
   */
  onPublished?: OnPublishedEffect;
};

/**
 * A bounded HTTP call to one of the Template's `mcpServers`, with the Agent's
 * credentials (as review effects). Placeholders in `path` and `body`: `{id}`
 * (the Mission's external id), `{publication.externalUrl}`,
 * `{publication.externalId}`. `responseIndexingField` names the response
 * field mirrored on `mission.indexing` (ADR-015).
 */
export type OnPublishedEffect = {
  server: string;
  method: "POST";
  path: string;
  body?: Record<string, string>;
  responseIndexingField?: string;
};

/** The only references an `onPublished` path or body may use. */
export const ON_PUBLISHED_PLACEHOLDERS = ["id", "publication.externalUrl", "publication.externalId"] as const;
export type OnPublishedPlaceholder = (typeof ON_PUBLISHED_PLACEHOLDERS)[number];

export type PublishResource = {
  /** An MCP tool of the server that ran the External Job. */
  tool: string;
  /** Argument carrying the job id. Default `runId`. */
  idArg?: string;
  /** Media field -> path in the tool output, when it does not use the
   * recommended names (`videoUrl`, `coverUrl`, `imageUrl`, `slideUrls`). */
  map?: Record<string, string>;
};

/** The default name of the argument that carries the job id. */
export const DEFAULT_RESOURCE_ID_ARG = "runId";

/** The `publish` declaration of a Mission type, or undefined when it has none
 * (or the Mission type is unknown). */
export function publishDeclarationFor(
  manifest: { missionTypes?: ReadonlyArray<{ type: string; publish?: PublishDeclaration }> } | undefined,
  missionType: string,
): PublishDeclaration | undefined {
  return manifest?.missionTypes?.find((entry) => entry.type === missionType)?.publish;
}

/** Returns an actionable reason, or undefined when `publish` is absent or valid.
 * `servers` are the Template's `mcpServers` names (`onPublished.server` must be one). */
export function publishDeclarationProblem(raw: unknown, at: string, servers: readonly string[] = []): string | undefined {
  if (raw === undefined) return undefined;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return `${at}.publish must be an object { kind, platforms?, require?, resource?, onPublished? }`;
  }
  const publish = raw as Record<string, unknown>;
  for (const key of Object.keys(publish)) {
    if (key !== "kind" && key !== "platforms" && key !== "require" && key !== "media" && key !== "resource" && key !== "onPublished") return `${at}.publish has unknown key "${key}"`;
  }
  if (!(PUBLISHABLE_KINDS as readonly unknown[]).includes(publish.kind)) {
    return `${at}.publish.kind ${JSON.stringify(publish.kind)} is not a known Publishable kind — one of ${PUBLISHABLE_KINDS.join(", ")}`;
  }
  if (publish.platforms !== undefined) {
    if (!Array.isArray(publish.platforms) || publish.platforms.length === 0) {
      return `${at}.publish.platforms must be a non-empty array of platforms, one of ${PLATFORM_IDS.join(", ")}`;
    }
    const seenPlatforms = new Set<unknown>();
    for (const platform of publish.platforms) {
      if (seenPlatforms.has(platform)) return `${at}.publish.platforms lists ${JSON.stringify(platform)} twice`;
      seenPlatforms.add(platform);
      if (!isKnownPlatform(platform)) {
        return `${at}.publish.platforms ${JSON.stringify(platform)} is not a known platform — one of ${PLATFORM_IDS.join(", ")}`;
      }
    }
  }
  if (publish.require !== undefined) {
    if (!Array.isArray(publish.require)) return `${at}.publish.require must be an array of field names`;
    const optional: readonly string[] = OPTIONAL_PUBLISHABLE_FIELDS[publish.kind as PublishableKind];
    const seen = new Set<unknown>();
    for (const field of publish.require) {
      if (seen.has(field)) return `${at}.publish.require lists ${JSON.stringify(field)} twice`;
      seen.add(field);
      if (typeof field !== "string" || !optional.includes(field)) {
        return `${at}.publish.require ${JSON.stringify(field)} is not an optional field of kind "${String(publish.kind)}" — one of ${optional.join(", ")} (required fields are always required)`;
      }
    }
  }
  if (publish.media !== undefined) {
    return `${at}.publish.media was replaced by publish.resource: { tool, idArg?, map? } — OpenGroow now calls the MCP tool \`resource.tool\` when the External Job completes (move your paths to resource.map)`;
  }
  if (publish.onPublished !== undefined) {
    const problem = onPublishedProblem(publish.onPublished, `${at}.publish.onPublished`, servers);
    if (problem) return problem;
  }
  if (publish.resource !== undefined) return publishResourceProblem(publish.resource, publish.kind as PublishableKind, at);
  if (isMcpOwnedKind(publish.kind as string)) {
    return `${at}.publish.resource is required for kind "${String(publish.kind)}": the MCP returns the whole Publishable, the Agent writes none of it`;
  }
  return undefined;
}

const ON_PUBLISHED_KEYS = new Set(["server", "method", "path", "body", "responseIndexingField"]);

/** The first reference of `template` outside `ON_PUBLISHED_PLACEHOLDERS`, as `{ref}`. */
function unknownPlaceholderIn(template: string): string | undefined {
  for (const match of template.matchAll(/\{([^}]*)\}/g)) {
    if (!(ON_PUBLISHED_PLACEHOLDERS as readonly string[]).includes(match[1])) return match[0];
  }
  return undefined;
}

function onPublishedProblem(raw: unknown, where: string, servers: readonly string[]): string | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return `${where} must be an object { server, method, path, body?, responseIndexingField? }`;
  }
  const effect = raw as Record<string, unknown>;
  for (const key of Object.keys(effect)) {
    if (!ON_PUBLISHED_KEYS.has(key)) return `${where} has unknown key "${key}"`;
  }
  if (typeof effect.server !== "string" || effect.server.length === 0) return `${where}.server must name one of mcpServers`;
  if (!servers.includes(effect.server)) return `${where}.server "${effect.server}" is not declared in mcpServers`;
  if (effect.method !== "POST") return `${where}.method must be "POST": ${JSON.stringify(effect.method)}`;
  if (typeof effect.path !== "string" || !effect.path.startsWith("/")) {
    return `${where}.path must start with / (relative to the server): ${JSON.stringify(effect.path)}`;
  }
  const allowed = ON_PUBLISHED_PLACEHOLDERS.map((ref) => `{${ref}}`).join(", ");
  const inPath = unknownPlaceholderIn(effect.path);
  if (inPath) return `${where}.path uses ${JSON.stringify(inPath)} — the only placeholders are ${allowed}`;
  if (effect.body !== undefined) {
    if (!effect.body || typeof effect.body !== "object" || Array.isArray(effect.body)) {
      return `${where}.body must be an object of strings`;
    }
    for (const [key, value] of Object.entries(effect.body as Record<string, unknown>)) {
      if (typeof value !== "string") return `${where}.body.${key} must be a string`;
      const inBody = unknownPlaceholderIn(value);
      if (inBody) return `${where}.body.${key} uses ${JSON.stringify(inBody)} — the only placeholders are ${allowed}`;
    }
  }
  if (effect.responseIndexingField !== undefined && (typeof effect.responseIndexingField !== "string" || effect.responseIndexingField.length === 0)) {
    return `${where}.responseIndexingField must be the name of a response field`;
  }
  return undefined;
}

const IDENTIFIER = /^[A-Za-z_][\w.-]*$/;

function publishResourceProblem(raw: unknown, kind: PublishableKind, at: string): string | undefined {
  const where = `${at}.publish.resource`;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return `${where} must be an object { tool, idArg?, map? }`;
  const resource = raw as Record<string, unknown>;
  for (const key of Object.keys(resource)) {
    if (key !== "tool" && key !== "idArg" && key !== "map") return `${where} has unknown key "${key}"`;
  }
  if (typeof resource.tool !== "string" || !IDENTIFIER.test(resource.tool)) {
    return `${where}.tool must be the name of an MCP tool: ${JSON.stringify(resource.tool)}`;
  }
  if (resource.idArg !== undefined && (typeof resource.idArg !== "string" || !IDENTIFIER.test(resource.idArg))) {
    return `${where}.idArg must be an argument name: ${JSON.stringify(resource.idArg)}`;
  }
  if (resource.map !== undefined) {
    if (!resource.map || typeof resource.map !== "object" || Array.isArray(resource.map)) {
      return `${where}.map must be an object mapping a media field to a path`;
    }
    const allowed: readonly string[] = RESOURCE_PUBLISHABLE_FIELDS[kind];
    for (const [field, path] of Object.entries(resource.map as Record<string, unknown>)) {
      if (!allowed.includes(field)) {
        return `${where}.map "${field}" is not a media field of kind "${kind}" — one of ${allowed.join(", ")}`;
      }
      const segments = typeof path === "string" ? path.split(".") : [];
      if (!segments.length || !segments.every((segment) => MEDIA_PATH_SEGMENT.test(segment))) {
        return `${where}.map.${field} is not a valid path (dot-separated keys, optional [n] or [*]): ${JSON.stringify(path)}`;
      }
      if (field !== "slideUrls" && String(path).includes("[*]")) {
        return `${where}.map.${field} cannot use [*]: only slideUrls takes a list`;
      }
    }
  }
  return undefined;
}

/**
 * Reads a value at a manifest media path (dot keys, `[n]`, `[*]`) from an MCP
 * tool output. `[*]` collects the rest of the path over every item of an array.
 */
export function readMediaPath(value: unknown, path: string): unknown {
  const tokens: Array<string | number | "*"> = [];
  for (const segment of path.split(".")) {
    const match = /^([^[]+)((?:\[(?:\*|\d+)\])*)$/.exec(segment);
    if (!match) return undefined;
    tokens.push(match[1]);
    for (const index of match[2].matchAll(/\[(\*|\d+)\]/g)) tokens.push(index[1] === "*" ? "*" : Number(index[1]));
  }
  const walk = (current: unknown, position: number): unknown => {
    if (position === tokens.length) return current;
    const token = tokens[position];
    if (token === "*") {
      if (!Array.isArray(current)) return undefined;
      const items = current.map((item) => walk(item, position + 1));
      return items.some((item) => item === undefined) ? undefined : items;
    }
    if (typeof token === "number") return Array.isArray(current) ? walk(current[token], position + 1) : undefined;
    if (!current || typeof current !== "object" || Array.isArray(current)) return undefined;
    return walk((current as Record<string, unknown>)[token], position + 1);
  };
  return walk(value, 0);
}
