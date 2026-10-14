/**
 * Install declaration of a machine-side tool (#726): where the artifact comes
 * from, how it is checked, how it is bootstrapped, and how its version is read.
 * Pure and dependency-free: it runs in the default Convex runtime, and the
 * installer (`machine-tool-install.ts`) consumes the same declaration.
 *
 * Commands are argv arrays, never shell strings: nothing is interpreted by a
 * shell, so what the user approves is exactly what runs. The only placeholder
 * is `{dir}`, the tool's install directory, chosen by the installer.
 */

export type MachineToolSource = {
  /** https URL of a `.tgz` release artifact of the hub's `tools/` directory. */
  url: string;
  /** Lowercase hex sha256 of the artifact; the download is refused on mismatch. */
  sha256: string;
};

/** A program the tool needs but OpenGroow cannot install itself (e.g. ADB). */
export type MachineToolRequirement = {
  name: string;
  /** argv run to detect it; exit code 0 means present. */
  check: string[];
  instructionsUrl: string;
};

export type MachineToolStep = {
  label: string;
  /** argv; `{dir}` is replaced by the install directory. */
  run: string[];
};

export type MachineToolVersionCheck = {
  /** argv whose output carries the installed version. */
  run: string[];
  /** Regex source with one capture group; defaults to the first `x.y.z`. */
  pattern?: string;
};

export type MachineToolInstall = {
  /** Slug naming the install directory on the machine. */
  id: string;
  source: MachineToolSource;
  requires?: MachineToolRequirement[];
  bootstrap?: MachineToolStep[];
  versionCheck?: MachineToolVersionCheck;
};

const SLUG = /^[a-z0-9][a-z0-9-]{0,62}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const PLACEHOLDER = /\{[^}]*\}/g;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isNonBlank = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;

function argvProblem(raw: unknown, at: string, key = "run"): string | undefined {
  if (!Array.isArray(raw) || raw.length === 0 || !raw.every(isNonBlank)) {
    return `${at}.${key} must be a non-empty array of non-blank strings (an argv, not a shell command)`;
  }
  for (const arg of raw as string[]) {
    for (const placeholder of arg.match(PLACEHOLDER) ?? []) {
      if (placeholder !== "{dir}") return `${at}.${key} uses the unknown placeholder ${placeholder} (only {dir} exists)`;
    }
  }
  return undefined;
}

/** First problem of a machine tool install declaration, as a message. */
export function machineToolInstallProblem(raw: unknown, at: string, minVersion: string | undefined): string | undefined {
  if (!isObj(raw)) return `${at} must be an object`;
  if (typeof raw.id !== "string" || !SLUG.test(raw.id)) return `${at}.id must be a lowercase slug (letters, digits, dashes)`;

  const source = raw.source;
  if (!isObj(source)) return `${at}.source must be an object`;
  if (typeof source.url !== "string" || !/^https:\/\/[^\s?#]+$/.test(source.url)) return `${at}.source.url must be an https URL`;
  if (!source.url.endsWith(".tgz")) return `${at}.source.url must point to a .tgz archive`;
  if (typeof source.sha256 !== "string" || !SHA256.test(source.sha256)) {
    return `${at}.source.sha256 must be 64 lowercase hex characters`;
  }

  if (raw.requires !== undefined) {
    if (!Array.isArray(raw.requires)) return `${at}.requires must be an array`;
    for (const [i, req] of raw.requires.entries()) {
      const rat = `${at}.requires[${i}]`;
      if (!isObj(req)) return `${rat} must be an object`;
      if (!isNonBlank(req.name)) return `${rat}.name must be a non-blank string`;
      const problem = argvProblem(req.check, rat, "check");
      if (problem) return problem;
      if (typeof req.instructionsUrl !== "string" || !/^https?:\/\/\S+$/.test(req.instructionsUrl)) {
        return `${rat}.instructionsUrl must be an http(s) URL`;
      }
    }
  }

  if (raw.bootstrap !== undefined) {
    if (!Array.isArray(raw.bootstrap)) return `${at}.bootstrap must be an array`;
    for (const [i, step] of raw.bootstrap.entries()) {
      const sat = `${at}.bootstrap[${i}]`;
      if (!isObj(step)) return `${sat} must be an object`;
      if (!isNonBlank(step.label)) return `${sat}.label must be a non-blank string`;
      const problem = argvProblem(step.run, sat);
      if (problem) return problem;
    }
  }

  if (raw.versionCheck !== undefined) {
    const check = raw.versionCheck;
    if (!isObj(check)) return `${at}.versionCheck must be an object`;
    const problem = argvProblem(check.run, `${at}.versionCheck`);
    if (problem) return problem;
    if (check.pattern !== undefined) {
      try {
        if (typeof check.pattern !== "string") throw new Error("not a string");
        const groups = new RegExp(`${check.pattern}|`).exec("")!.length - 1;
        if (groups < 1) return `${at}.versionCheck.pattern must contain a capture group around the version`;
      } catch {
        return `${at}.versionCheck.pattern must be a valid regular expression`;
      }
    }
  } else if (minVersion !== undefined) {
    return `${at}.versionCheck is required when minVersion is declared`;
  }
  return undefined;
}
