import type { AnalyticsAdapterMeta } from "@opengroow/publisher-sdk";
import type { Doc } from "./_generated/dataModel.js";
import { normalizePostUrl } from "./post_url.js";
import { linkedAdapters } from "./analytics_adapters.js";
import type { PublicationInWindow } from "./analytics_window.js";

// Shared measurement keys (ADR-084): two Publications of one URL-based adapter can measure the same page.
// Who claims the page is settled before any group is read: all in one group, the first Publication
// carries the figures and the others are `shared`; in several groups (or one and no group), no group is
// credited and each Publication is `ambiguous`. An `externalId` is never shared, so never deduplicated.

type Claim = { groups: Set<string | undefined>; first: Doc<"publications"> };
export type Claims = Map<string, Claim>;
export type ClaimStatus = "own" | "shared" | "ambiguous";

const keyFor = (adapter: AnalyticsAdapterMeta, publication: Doc<"publications">) =>
  adapter.needs === "url" && publication.externalUrl ? `${adapter.id}\n${normalizePostUrl(publication.externalUrl)}` : undefined;

/** Who claims each shared page, the groups being whatever `groupOf` says (a Publication with no group is `undefined`). */
export function measurementClaims(
  inWindow: PublicationInWindow[],
  installed: Parameters<typeof linkedAdapters>[0],
  groupOf: (item: PublicationInWindow) => string | undefined,
): Claims {
  const claims: Claims = new Map();
  for (const item of inWindow) {
    const { publication, found } = item;
    if (!found) continue;
    for (const { adapter } of linkedAdapters(installed, found.publisher.adapter, found.channel.analyticsAdapter)) {
      const key = keyFor(adapter, publication);
      if (key === undefined) continue;
      const claim = claims.get(key) ?? { groups: new Set(), first: publication };
      claims.set(key, claim);
      claim.groups.add(groupOf(item));
      if (publication._creationTime < claim.first._creationTime || (publication._creationTime === claim.first._creationTime && publication._id < claim.first._id)) claim.first = publication;
    }
  }
  return claims;
}

/** Whether this Publication's figures are read for this adapter: its own, shared with an earlier one, or ambiguous. */
export function claimStatus(claims: Claims, adapter: AnalyticsAdapterMeta, publication: Doc<"publications">): ClaimStatus {
  const claim = claims.get(keyFor(adapter, publication) ?? "");
  if (claim && claim.groups.size > 1) return "ambiguous";
  if (claim && claim.first._id !== publication._id) return "shared";
  return "own";
}
