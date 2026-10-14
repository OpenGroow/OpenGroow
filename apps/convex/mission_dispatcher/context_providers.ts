/**
 * Declarative context providers (issue #429).
 *
 * A generic, pure mechanism letting an Agent Template opt into extra
 * `context.md` sections via `manifest.contextProviders: string[]`.
 * Each provider name maps to a registered renderer that takes plain data
 * and returns a markdown section string (or null if nothing to render).
 *
 * The dispatcher calls `appendContextProviders` after `buildMissionContext`
 * — these providers live alongside it, not inside it, because (unlike
 * Brand Core) they are not meaningful to every Template.
 */

import { SOCIAL_ENGAGEMENT_PLATFORMS, singleLine, type ContextProviderName } from "@opengroow/agent-templates";

// ─── Active agents provider ─────────────────────────────────────────────────

export type ActiveAgentInfo = {
  templateId: string;
  name: string;
  templateName: string;
  description: string;
  capabilities: string[];
};

/**
 * Pure, dependency-free renderer for the active-agents context provider.
 *
 * Takes the list of active Agents on the Instance (name, Template,
 * capabilities) and renders them as a markdown section. Returns `null`
 * when the list is empty.
 */
export function renderActiveAgentsSection(agents: ActiveAgentInfo[]): string | null {
  if (agents.length === 0) return null;

  const sorted = [...agents].sort((a, b) => a.name.localeCompare(b.name));

  const lines = ["# Active Agents", ""];

  for (const a of sorted) {
    const caps = a.capabilities.length > 0 ? a.capabilities.join(", ") : "none";
    lines.push(`- **${a.name}** (${a.templateName}) [templateId: ${a.templateId}]: ${a.description}`);
    lines.push(`  Capabilities: ${caps}`);
  }

  lines.push("");
  return lines.join("\n");
}

// ─── Carousel planning source provider (issue #504) ─────────────────────────

export type CarouselPlanningSourceInfo = {
  /** The platform the source Observation itself came from — the default the
   * instruction file tells the Agent to prefer for `publish.platforms`. */
  platform: "instagram" | "tiktok";
  mediaType?: "video" | "image" | "carousel";
  /** `creativeFeatures.format`/`mediaStructure` (issue #455): the
   * most direct structural read the analysis MCP produces — how many beats the
   * source carousel is built from, and in what shape. The Agent's slide count
   * comes from here first, and only falls back to inferring one from the
   * free-text `reproducibleElements`/`analysis.pacing`. */
  format?: string;
  mediaStructure?: string;
  creativeMechanic?: string;
  reproducibleElements?: string[];
  topicSpecificElements?: string[];
  analysis?: {
    hook: string;
    pacing: string;
    narrativeStructure: string;
    payoff: string;
    cta: string;
  };
  /** Only ever set for `carousel` Observations — `video` is not produced by
   * `create_carousel`, so this stays absent and the renderer skips its line. */
  producesCarousel?: true;
} | null;

/**
 * Pure, dependency-free renderer for `routing`'s own
 * context provider: the parts of the Observation's deep-enrichment read
 * (issue #455) that describe the source post's *structure* —
 * `creativeMechanic`, `analysis`, `reproducibleElements` — plus, for
 * `carousel` sources only, an output line telling the Agent to pick the
 * `carouselFormat`/`contentPattern` that fits the Creative Mechanic from
 * `list_content_patterns`. `video` sources (issue #513) get every other part: the
 * structural read is the same shape for both, only the downstream production
 * pipeline differs.
 *
 * `topicSpecificElements` is rendered too, but under a heading that says
 * outright it must never seed generated content — surfacing it
 * lets the Agent recognize and deliberately avoid the source's topic, rather
 * than never seeing it and risking topic leakage by accident.
 *
 * Returns `null` when the Observation couldn't be found or is neither a
 * `carousel` nor a `video` — the instruction file's own "not implemented yet"
 * path covers that case.
 */
export function renderCarouselPlanningSourceSection(info: CarouselPlanningSourceInfo): string | null {
  if (!info) return null;

  const lines = ["# Observation Production Source", ""];

  if (info.mediaType) lines.push(`- Media type: \`${info.mediaType}\``);
  lines.push(`- Source platform: \`${info.platform}\``);
  if (info.format) lines.push(`- Format: ${info.format}`);
  if (info.mediaStructure) lines.push(`- Media structure: ${info.mediaStructure}`);

  // Gated on the field's own presence, not on `mediaType`: the query is the
  // single place that decides which media types are produced as a Carousel
  // (only `carousel` today), and repeating that decision here would be a
  // second switch to keep in sync when a third media type lands.
  if (info.producesCarousel) {
    lines.push(
      "- Output: a `create_carousel` Carousel — pick the `carouselFormat`/`contentPattern` that fits the Creative Mechanic from `list_content_patterns`",
    );
  }
  lines.push("");

  if (info.creativeMechanic) {
    lines.push("## Creative Mechanic", "", info.creativeMechanic, "");
  }

  if (info.analysis) {
    lines.push(
      "## Analysis",
      "",
      `- Hook: ${info.analysis.hook}`,
      `- Pacing: ${info.analysis.pacing}`,
      `- Narrative structure: ${info.analysis.narrativeStructure}`,
      `- Payoff: ${info.analysis.payoff}`,
      `- CTA: ${info.analysis.cta}`,
      "",
    );
  }

  if (info.reproducibleElements && info.reproducibleElements.length > 0) {
    lines.push(
      "## Reproducible Elements",
      "",
      "Structural elements you may replicate on your own Instance's product:",
      "",
      ...info.reproducibleElements.map((e) => `- ${e}`),
      "",
    );
  }

  if (info.topicSpecificElements && info.topicSpecificElements.length > 0) {
    lines.push(
      "## Topic-Specific Elements (do not use)",
      "",
      "Tied specifically to the source post's own topic — never use these as generation input:",
      "",
      ...info.topicSpecificElements.map((e) => `- ${e}`),
      "",
    );
  }

  return lines.join("\n");
}

// ─── Platform account provider (issue #660) ─────────────────────────────────

export type PlatformAccountInfo = {
  runId: string;
  /** The Agent's config. */
  config: Record<string, unknown>;
  /** The dispatching Mission's payload; its `platform` selects the account. */
  payload: Record<string, unknown> | undefined;
};

/**
 * Pure renderer for the platform-account provider: the platform chosen by the
 * Mission payload selects the Agent's matching account handle (issue #352),
 * which is rendered with the Agent's account description and like/avoid/comment
 * criteria. Fails loudly instead of defaulting: `missions.create` takes
 * `payload: v.any()` and the dashboard has a raw-JSON escape hatch, so an
 * absent or unknown `platform` is reachable (notably from Schedules created
 * before #352), and engaging from the wrong account is worse than a visible
 * failed Run. Neither handle requirement is mandatory at activation time (an
 * Agent may only ever run one platform), so a handle missing for the chosen
 * platform fails the same way. The dispatcher's catch turns a throw into a
 * failed Run.
 */
export function renderPlatformAccountSection({ runId, config, payload }: PlatformAccountInfo): string {
  const platform = payload?.platform as string | undefined;
  const platformSpec = platform ? SOCIAL_ENGAGEMENT_PLATFORMS[platform] : undefined;
  if (!platformSpec) {
    throw new Error(
      `platform-account context: the Mission payload has no supported \`platform\` (got ${JSON.stringify(platform)}; expected one of ${Object.keys(SOCIAL_ENGAGEMENT_PLATFORMS).join(", ")})`,
    );
  }
  const accountHandle = config[platformSpec.accountHandleKey] as string | undefined;
  if (!accountHandle) {
    throw new Error(
      `platform-account context: the Agent config has no \`${platformSpec.accountHandleKey}\` (${platformSpec.label} handle) set, but this Mission targets \`${platform}\``,
    );
  }
  // Free text from the Agent's config stays on its list item (see `singleLine`).
  const text = (value: unknown): string => (typeof value === "string" ? singleLine(value) : "");
  const lines = [
    "## Social Engagement Runtime Context",
    "",
    `- runId: \`${runId}\``,
    `- platform: \`${platform}\``,
    `- accountHandle (${platformSpec.label} handle): \`${text(accountHandle)}\``,
    `- accountBio: ${text(config.accountBio)}`,
    `- likeWhen: ${text(config.likeWhen)}`,
  ];
  if (config.avoid) lines.push(`- avoid: ${text(config.avoid)}`);
  if (config.commentWhen) lines.push(`- commentWhen: ${text(config.commentWhen)}`);
  lines.push("");
  return lines.join("\n");
}

function renderPlatformAccountFromUnknown(data: unknown): string {
  // Unlike the informational providers, this one never renders nothing: an
  // engage Run without its account context would engage blind, so missing
  // data fails the Run like the checks above.
  if (!data || typeof data !== "object") {
    throw new Error("platform-account context provider received no data from the dispatcher");
  }
  return renderPlatformAccountSection(data as PlatformAccountInfo);
}

// ─── Provider registry ──────────────────────────────────────────────────────

type ContextProviderRenderer = (data: unknown) => string | null;

function renderActiveAgentsFromUnknown(data: unknown): string | null {
  if (!Array.isArray(data)) return null;
  return renderActiveAgentsSection(data as ActiveAgentInfo[]);
}

function renderCarouselPlanningSourceFromUnknown(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  return renderCarouselPlanningSourceSection(data as CarouselPlanningSourceInfo);
}

/**
 * Registry mapping provider name → pure renderer.
 * The dispatcher looks up each name a Template declares in
 * `contextProviders` and calls the matching renderer with the
 * fetched data. Unknown names cause a validation error.
 */
export const CONTEXT_PROVIDER_RENDERERS: Record<ContextProviderName, ContextProviderRenderer> = {
  "active-agents": renderActiveAgentsFromUnknown,
  "observation-production-source": renderCarouselPlanningSourceFromUnknown,
  "platform-account": renderPlatformAccountFromUnknown,
};

/** Providers that render the Agent's config: a Run cannot dispatch for them on an absent config. */
export const CONTEXT_PROVIDERS_REQUIRING_CONFIG: ReadonlySet<string> = new Set<ContextProviderName>(["platform-account"]);

/** Set of valid provider names for manifest validation. */
export const VALID_CONTEXT_PROVIDER_NAMES = new Set(Object.keys(CONTEXT_PROVIDER_RENDERERS));

// ─── Dispatch helper ────────────────────────────────────────────────────────

/**
 * Appends context provider sections to a base `context.md`.
 * Pure — the caller fetches provider data via Convex queries and passes it in.
 *
 * @param baseContextMd  The markdown produced by `buildMissionContext` + runtime context.
 * @param providerNames  The Template's `contextProviders` list.
 * @param providerData   A map of provider name → fetched data for that provider.
 * @returns The base markdown with provider sections appended.
 */
export function appendContextProviders(
  baseContextMd: string,
  providerNames: string[],
  providerData: Record<string, unknown>,
): string {
  let result = baseContextMd;
  for (const name of providerNames) {
    const renderer = (CONTEXT_PROVIDER_RENDERERS as Partial<Record<string, ContextProviderRenderer>>)[name];
    if (!renderer) continue;
    const section = renderer(providerData[name]);
    if (section) result += "\n" + section;
  }
  return result;
}
