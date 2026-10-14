import { OFFICIAL_SCOPE } from "./official-scope.js";

/**
 * The release of the system Template `@opengroow/source` that every new Project
 * installs from the hub (#673). The digest lives in the product, not only in
 * the hub index: Source captures the Sources of every Project, so an edited or
 * compromised index must not be able to substitute another package. Changing
 * the Template's version is a code change here, reviewed like any other.
 *
 * Pure and dependency-free: it runs in the default Convex runtime.
 */

export const PINNED_SOURCE_TEMPLATE_ID = `${OFFICIAL_SCOPE}source`;

export type PinnedRelease = {
  /** `owner/repo` of the package repository. */
  repository: string;
  tag: string;
  /** `*.tgz` attached to the release of `tag`, when the package is a release asset. */
  asset?: string;
  /** `sha256:<hex>` of the release archive (or of the asset). */
  digest: string;
};

/**
 * Release of `@opengroow/source` published in `OpenGroow/groowhub`. The digest
 * must match the release asset: update all four fields together when the
 * release is cut (the digest of the first local build is recomputed by the
 * release workflow, so refresh it from the published asset).
 */
export const PINNED_SOURCE_RELEASE: PinnedRelease = {
  repository: "OpenGroow/groowhub",
  tag: "source@1.0.0",
  asset: "opengroow-source-1.0.0.tgz",
  digest: "sha256:e133bd37a737e80993bdee8ae45be21bf394a3b04a9324a04b3550fd77ce19b0",
};
