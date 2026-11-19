"use node";

// What loading an installed hub package's code has in common, whatever its kind (ADR-072, ADR-078).
// Only Node actions can evaluate a bundle (a `data:` import, which the V8 runtime of queries and
// mutations does not allow). The bundle is the hub's, verified by digest at install, and runs with
// the core's rights (no isolation). A kind brings only what it checks of the export.

type Bundle = { packageId: string; digest: string; source: string };

/**
 * The export of `bundle` once checked by `build`, cached per package digest in the kind's own `cache`:
 * an upgrade changes the digest, so a new version is loaded on its first use and drops the earlier
 * digests of the package. `label` names the package in the error when its code cannot be evaluated.
 */
export async function loadCachedBundle<T>(cache: Map<string, T>, bundle: Bundle, label: string, build: (exported: unknown) => T): Promise<T> {
  const key = `${bundle.packageId}#${bundle.digest}`;
  const cached = cache.get(key);
  if (cached) return cached;

  let module: { default?: unknown };
  try {
    module = await import(/* webpackIgnore: true */ `data:text/javascript;base64,${Buffer.from(bundle.source).toString("base64")}`);
  } catch (error) {
    throw new Error(`${label} could not be loaded: ${error instanceof Error ? error.message : String(error)}`);
  }
  const loaded = build(module.default);
  for (const k of cache.keys()) if (k.startsWith(`${bundle.packageId}#`)) cache.delete(k);
  cache.set(key, loaded);
  return loaded;
}
