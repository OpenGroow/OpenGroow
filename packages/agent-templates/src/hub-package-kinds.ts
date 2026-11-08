/**
 * The kinds of hub package that are not Templates (ADR-072). Kept apart from
 * `hub-index` (which reads archives with node:crypto/zlib) so the default
 * Convex runtime can import it: `apps/convex/hub_package_kinds.ts` runs there.
 */
export const HUB_PACKAGE_KINDS = ["publisher"] as const;
export type HubPackageKind = (typeof HUB_PACKAGE_KINDS)[number];
