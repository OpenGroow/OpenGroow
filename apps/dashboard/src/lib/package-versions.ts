/** The version of a hub tag: `publisher-postiz@1.0.2` -> `1.0.2`. */
export function versionOfTag(tag: string): string | undefined {
  const at = tag.lastIndexOf("@");
  const version = at > 0 ? tag.slice(at + 1) : "";
  return /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version) ? version : undefined;
}

/**
 * Whether `candidate` is a newer semver than `installed`: numeric
 * major.minor.patch, and a release beats a pre-release of the same version
 * (`1.0.0` > `1.0.0-rc.1`). Pre-releases are not compared further.
 */
export function isNewerVersion(candidate: string, installed: string): boolean {
  const parse = (v: string) => {
    const [core = "", pre] = v.split("-", 2);
    return { parts: core.split(".").map((n) => Number.parseInt(n, 10) || 0), pre };
  };
  const a = parse(candidate);
  const b = parse(installed);
  for (let i = 0; i < 3; i++) {
    const diff = (a.parts[i] ?? 0) - (b.parts[i] ?? 0);
    if (diff !== 0) return diff > 0;
  }
  return a.pre === undefined && b.pre !== undefined;
}
