export type OpenClawAgentSummary = { id: string; workspace?: string };

// Scans forward from `start` (which must point at a `[` or `{`) and returns
// the index just past the matching close bracket, tracking nesting depth and
// skipping over string contents (including escapes) so brackets inside
// string values — or inside trailing non-JSON text appended after the real
// value — can't be mistaken for the top-level close. A naive
// `lastIndexOf("]")` breaks here: openclaw's ANSI-colored stderr warnings
// (e.g. "\x1b[32m[state-migrations]\x1b[39m") contain their own literal `]`
// after the real JSON, which `lastIndexOf` would find instead.
export function findTopLevelJsonEnd(text: string, start: number): number {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
    } else if (ch === "[" || ch === "{") {
      depth++;
    } else if (ch === "]" || ch === "}") {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}

export function parseOpenClawAgents(output: string): OpenClawAgentSummary[] {
  // Canonical schema (openclaw `agents list --json`): top-level array of
  // { id, name, workspace, agentDir, model, bindings, isDefault, ... }.
  //
  // The exec transport (control-socket-server.js's `/openclaw/exec`)
  // normally returns clean stdout on success, but this stays defensive in
  // case any other diagnostics ever get appended: slice out just the
  // top-level JSON array instead of trusting the whole payload.
  const trimmed = (output || "").trim();
  // Anchored at position 0, not a bare indexOf("[") search: the top-level
  // value must itself be the array. Searching anywhere in the text would
  // also match a `[` nested inside an unrelated top-level object (e.g.
  // `{"agents":[]}`), silently slicing out that inner array instead of
  // surfacing "expected a top-level array" for a genuinely malformed
  // response shape.
  const start = trimmed.startsWith("[") ? 0 : -1;
  const end = start !== -1 ? findTopLevelJsonEnd(trimmed, start) : -1;
  const jsonSlice = start !== -1 && end !== -1 ? trimmed.slice(start, end) : trimmed || "[]";
  const parsed = JSON.parse(jsonSlice) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error("expected a top-level array");
  }
  const summaries: OpenClawAgentSummary[] = [];
  for (const entry of parsed) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      continue;
    }
    const record = entry as Record<string, unknown>;
    const id = record.id;
    if (typeof id !== "string" || id.length === 0) {
      continue;
    }
    const workspace = typeof record.workspace === "string" && record.workspace.length > 0
      ? record.workspace
      : undefined;
    summaries.push({ id, workspace });
  }
  return summaries;
}
