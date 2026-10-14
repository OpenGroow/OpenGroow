/**
 * Declarative run-context block (issue #659). A Template declares, in its
 * manifest, the markdown section OpenGroow appends to a Run's `context.md`.
 *
 * Every line is plain text with `{reference}` tokens drawn from a fixed
 * grammar. Interpolation is bounded text substitution: a token is replaced by
 * a value, and the result is never parsed again — no code, no expressions.
 *
 * Grammar (the only references a block may use):
 *   {run.id}            the Run's id
 *   {config.<key>}      a key of the Agent's config
 *   {payload.<key>}     a key of the dispatching Mission's payload
 *   {date.today}        today, UTC, `YYYY-MM-DD`
 *   {date.today-<N>d}   N days before today (`{date.today+<N>d}` for after)
 *
 * A line is omitted when one of its `config`/`payload` references has no value
 * (absent, null or empty), so optional settings need no conditional syntax.
 */

import { isPlainObject } from "./job-declarations";
import { flattenRequirementFields } from "./requirements";
import type { RequirementField, RunContextDeclaration } from "./types";

export type RunContextReference =
  | { kind: "run" }
  | { kind: "config"; key: string }
  | { kind: "payload"; key: string }
  | { kind: "date"; offsetDays: number };

export type RunContextInputs = {
  runId: string;
  /** The Agent's config. */
  config: Record<string, unknown>;
  /** The dispatching Mission's payload, when it has one. */
  payload?: Record<string, unknown>;
  /**
   * Config keys that hold secrets (the manifest's password requirements): never
   * rendered. `apiKey`, the credential OpenGroow stores in every Agent's config,
   * is always withheld.
   */
  secretConfigKeys?: ReadonlySet<string>;
  /** Epoch milliseconds the relative dates are computed from. */
  now: number;
};

const DAY_MS = 24 * 60 * 60 * 1000;
const TOKEN = /\{([^{}]*)\}/g;
const KEY = "[A-Za-z_][A-Za-z0-9_]*";
const REFERENCE = new RegExp(`^(?:(run)\\.id|(config|payload)\\.(${KEY})|date\\.today(?:([+-])(\\d+)d)?)$`);

function parseReference(text: string): RunContextReference | undefined {
  const match = REFERENCE.exec(text);
  if (!match) return undefined;
  const [, run, scope, key, sign, days] = match;
  if (run) return { kind: "run" };
  if (scope === "config" || scope === "payload") return { kind: scope, key };
  return { kind: "date", offsetDays: days === undefined ? 0 : (sign === "-" ? -1 : 1) * Number(days) };
}

/**
 * The references of one line, in order, or an Error naming the first token that
 * is not part of the grammar (including a stray `{` or `}`).
 */
export function runContextReferences(line: string): RunContextReference[] | Error {
  const references: RunContextReference[] = [];
  for (const [token, inner] of line.matchAll(TOKEN)) {
    const reference = parseReference(inner);
    if (!reference) return new Error(`unknown reference "${token}"`);
    references.push(reference);
  }
  if (line.replace(TOKEN, "").match(/[{}]/)) return new Error(`unbalanced "{" or "}" in ${JSON.stringify(line)}`);
  return references;
}

function present(value: unknown): string | undefined {
  if (typeof value === "string") return value === "" ? undefined : value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return undefined;
}

/**
 * A free-text value on one line: line breaks become spaces so a value cannot
 * leave its list item and add headings or items of its own to a Run's context.
 */
export function singleLine(value: string): string {
  return value.replace(/[\r\n]+/g, " ");
}

/** Only the object's own keys resolve: never an inherited property such as `constructor` (#670). */
function ownValue(source: Record<string, unknown>, key: string): unknown {
  return Object.prototype.hasOwnProperty.call(source, key) ? source[key] : undefined;
}

function withheldConfigKey(key: string, inputs: RunContextInputs): boolean {
  return key === "apiKey" || inputs.secretConfigKeys?.has(key) === true;
}

function resolve(reference: RunContextReference, inputs: RunContextInputs): string | undefined {
  switch (reference.kind) {
    case "run":
      return inputs.runId;
    case "config":
      return withheldConfigKey(reference.key, inputs) ? undefined : present(ownValue(inputs.config, reference.key));
    case "payload":
      // A Mission payload is untyped JSON: only an object has keys to read.
      return isPlainObject(inputs.payload) ? present(ownValue(inputs.payload, reference.key)) : undefined;
    case "date":
      return new Date(inputs.now + reference.offsetDays * DAY_MS).toISOString().slice(0, 10);
  }
}

function renderLine(line: string, inputs: RunContextInputs): string | undefined {
  let missing = false;
  const rendered = line.replace(TOKEN, (_token, inner: string) => {
    const value = resolve(parseReference(inner)!, inputs);
    if (value === undefined) missing = true;
    return value === undefined ? "" : singleLine(value);
  });
  return missing ? undefined : rendered;
}

/**
 * Renders the block as the markdown section appended to `context.md`: a `##`
 * heading followed by one list item per line. Assumes a declaration that
 * passed `validateManifest`.
 */
export function renderRunContext(declaration: RunContextDeclaration, inputs: RunContextInputs): string {
  const items = declaration.lines.flatMap((line) => {
    const rendered = renderLine(line, inputs);
    return rendered === undefined ? [] : [`- ${rendered}`];
  });
  return [`## ${declaration.heading}`, "", ...items, ""].join("\n");
}

/** What `validateRunContext` checks references against. */
type RunContextScope = {
  /** Requirement keys that hold secrets: never rendered into a Run's context. */
  secretConfigKeys: Set<string>;
  /** Payload keys some Mission type of the manifest declares. */
  payloadKeys: Set<string>;
};

/**
 * The scope a manifest gives its run-context references. `{config.<key>}` is
 * deliberately not checked against the declared requirements: an Agent's
 * stored config can carry keys a later Template version no longer declares
 * (Video Demo's `defaultFormat`, issue #626), and such a line simply renders
 * nothing when the key is absent. Only secret requirements are refused.
 */
function scopeOf(manifest: { requirements?: unknown; missionTypes?: unknown }): RunContextScope {
  const requirements = Array.isArray(manifest.requirements) ? (manifest.requirements as RequirementField[]) : [];
  return {
    secretConfigKeys: new Set(
      flattenRequirementFields(requirements)
        .filter((field) => field.type === "password")
        .map((field) => field.key),
    ),
    payloadKeys: declaredPayloadKeys(manifest.missionTypes),
  };
}

/** Payload keys the Mission types declare: their `fields` plus the keys of their default `payload` JSON. */
function declaredPayloadKeys(missionTypes: unknown): Set<string> {
  const keys = new Set<string>();
  for (const missionType of Array.isArray(missionTypes) ? (missionTypes as Array<Record<string, unknown>>) : []) {
    if (Array.isArray(missionType.fields)) {
      for (const field of missionType.fields as Array<Record<string, unknown>>) {
        if (typeof field.key === "string") keys.add(field.key);
      }
    }
    if (typeof missionType.payload === "string") {
      try {
        const defaults: unknown = JSON.parse(missionType.payload);
        if (isPlainObject(defaults)) for (const key of Object.keys(defaults)) keys.add(key);
      } catch {
        // A free-text default payload declares no keys.
      }
    }
  }
  return keys;
}

/**
 * Why `raw` is not a valid run-context declaration of `manifest` (whose
 * `requirements` and `missionTypes` were already validated), or undefined
 * when it is.
 */
export function validateRunContext(
  raw: unknown,
  manifest: { requirements?: unknown; missionTypes?: unknown },
): string | undefined {
  const scope = scopeOf(manifest);
  const fail = (why: string) => `'runContext' ${why}`;
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return fail("must be an object");
  const { heading, lines } = raw as Record<string, unknown>;
  if (typeof heading !== "string" || heading.trim() === "") return fail("needs a non-blank 'heading'");
  if (!Array.isArray(lines) || lines.length === 0 || !lines.every((line) => typeof line === "string" && line.trim() !== "")) {
    return fail("needs 'lines': a non-empty array of non-blank strings");
  }
  for (const line of lines as string[]) {
    const references = runContextReferences(line);
    if (references instanceof Error) {
      return fail(`line ${JSON.stringify(line)}: ${references.message} — allowed: {run.id}, {config.<key>}, {payload.<key>}, {date.today}, {date.today-<N>d}`);
    }
    for (const reference of references) {
      if (reference.kind === "config" && scope.secretConfigKeys.has(reference.key)) {
        return fail(`line ${JSON.stringify(line)}: "{config.${reference.key}}" is a secret requirement and is never exposed to a Run`);
      }
      if (reference.kind === "payload" && !scope.payloadKeys.has(reference.key)) {
        return fail(`line ${JSON.stringify(line)}: "{payload.${reference.key}}" is not a key any Mission type declares`);
      }
    }
  }
  return undefined;
}
