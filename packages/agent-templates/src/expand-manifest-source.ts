/**
 * A Template whose Mission types all share the same review contract, External
 * Job polling and generative MCP call can write that contract once, in a
 * `missionContract` section of a `manifest.source.json`, instead of copying it
 * into every Mission type. `expandManifestSource` produces the full
 * `manifest.json`, where every Mission type still declares its own explicit
 * contract (GLOSSARY.md: Mission-type contracts are explicit) — the loader, the
 * dispatcher and the dashboard only ever read the expanded file.
 */

export type MissionTypeSource = { type: string } & Record<string, unknown>;

export type MissionContractSource = {
  /** Review contract copied into every Mission type that does not declare its own. */
  review?: unknown;
  /** External Job polling contracts (keyed by job type) copied for every Mission type. */
  externalJobs?: Record<string, unknown>;
  /** Generative MCP call copied for every Mission type. */
  generativeMcpCall?: unknown;
};

export type ManifestSource = Record<string, unknown> & {
  missionContract?: MissionContractSource;
  missionTypes?: MissionTypeSource[];
};

export type ExpandedManifest = Omit<ManifestSource, "missionContract">;

// `Object.prototype.hasOwnProperty.call` rather than `Object.hasOwn`: Convex
// typechecks this package with `lib: ES2021`, which has no `Object.hasOwn`.

/** An independent copy per Mission type, so editing one never changes another. */
function copy<T>(value: T): T {
  return structuredClone(value);
}

export function expandManifestSource(source: ManifestSource): ExpandedManifest {
  const { missionContract, ...manifest } = source;
  if (!missionContract) return manifest;

  const missionTypes = (manifest.missionTypes ?? []).map((missionType) =>
    missionType.review === undefined && missionContract.review !== undefined
      ? { ...missionType, review: copy(missionContract.review) }
      : missionType,
  );
  const expanded: ExpandedManifest = { ...manifest, missionTypes };

  if (missionContract.generativeMcpCall !== undefined) {
    const existing = (manifest.generativeMcpCall ?? {}) as Record<string, unknown>;
    expanded.generativeMcpCall = Object.fromEntries([
      ...Object.entries(existing),
      ...missionTypes
        .filter((missionType) => !Object.prototype.hasOwnProperty.call(existing, missionType.type))
        .map((missionType) => [missionType.type, copy(missionContract.generativeMcpCall)]),
    ]);
  }

  if (missionContract.externalJobs !== undefined) {
    const existing = (manifest.externalJobsByMissionType ?? {}) as Record<string, unknown>;
    expanded.externalJobsByMissionType = Object.fromEntries([
      ...Object.entries(existing),
      ...missionTypes
        .filter((missionType) => !Object.prototype.hasOwnProperty.call(existing, missionType.type))
        .map((missionType) => [missionType.type, copy(missionContract.externalJobs)]),
    ]);
  }

  return expanded;
}
