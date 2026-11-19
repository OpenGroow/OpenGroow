/**
 * The kinds of hub package that are not Templates (ADR-072). Kept apart from
 * `hub-index` (which reads archives with node:crypto/zlib) so the default
 * Convex runtime can import it: `apps/convex/hub_package_kinds.ts` runs there.
 */
export const HUB_PACKAGE_KINDS = ["publisher", "analytics"] as const;
export type HubPackageKind = (typeof HUB_PACKAGE_KINDS)[number];

/** The index file of a kind at the hub root: `publishers.json` for Publishers, `analytics.json` for Analytics Adapters (ADR-078). */
const HUB_PACKAGE_INDEX_FILES = { publisher: "publishers.json", analytics: "analytics.json" } as const satisfies Record<HubPackageKind, string>;
export const hubPackageIndexFile = (kind: HubPackageKind): string => HUB_PACKAGE_INDEX_FILES[kind];
