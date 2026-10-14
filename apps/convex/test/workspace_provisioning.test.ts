import { describe, expect, it } from "vitest";
import { findTopLevelJsonEnd, parseOpenClawAgents } from "@opengroow/protocol";

describe("parseOpenClawAgents", () => {
  it("parses a clean top-level JSON array", () => {
    const output = JSON.stringify([
      { id: "main", workspace: "/home/node/.openclaw/workspace" },
    ]);
    expect(parseOpenClawAgents(output)).toEqual([
      { id: "main", workspace: "/home/node/.openclaw/workspace" },
    ]);
  });

  it("skips entries missing a non-empty id", () => {
    const output = JSON.stringify([
      { id: "main", workspace: "/ws" },
      { workspace: "/no-id" },
      { id: "", workspace: "/empty-id" },
    ]);
    expect(parseOpenClawAgents(output)).toEqual([{ id: "main", workspace: "/ws" }]);
  });

  it("omits workspace when absent or empty", () => {
    const output = JSON.stringify([{ id: "main", workspace: "" }, { id: "other" }]);
    expect(parseOpenClawAgents(output)).toEqual([{ id: "main" }, { id: "other" }]);
  });

  // Regression test (self-host issue, 2026-07-07): control-socket-server.js's
  // `/openclaw/exec` used to merge stdout+stderr into one string. `openclaw`
  // prints ANSI-colored state-migration warnings to stderr — e.g.
  // "\x1b[32m[state-migrations]\x1b[39m ..." — which get appended right
  // after the real JSON array on stdout. That stderr text itself contains a
  // literal `]` (from the literal "[state-migrations]"), so a naive
  // `lastIndexOf("]")` picks the wrong bracket and still fails to parse. The
  // scanner must track nesting depth to find the *true* end of the
  // top-level array instead.
  it("ignores trailing non-JSON text containing its own brackets", () => {
    const agents = [{ id: "main", workspace: "/home/node/.openclaw/workspace" }];
    const trailingNoise =
      "\n[32m[state-migrations][39m [33mLegacy state migration warnings:[39m" +
      "\n[33m- Left legacy config health state in place because 1 entry conflicts" +
      " with shared SQLite state: /home/node/.openclaw/logs/config-health.json[39m";
    const output = JSON.stringify(agents, null, 2) + trailingNoise;
    expect(parseOpenClawAgents(output)).toEqual(agents);
  });

  it("ignores brackets inside string values when finding the array end", () => {
    const agents = [{ id: "main", workspace: "/weird]/[path" }];
    const output = JSON.stringify(agents) + "\ntrailing [not json]";
    expect(parseOpenClawAgents(output)).toEqual(agents);
  });

  it("throws when the payload isn't a top-level array", () => {
    expect(() => parseOpenClawAgents(JSON.stringify({ id: "main" }))).toThrow(
      "expected a top-level array",
    );
  });

  it("throws on genuinely invalid JSON", () => {
    expect(() => parseOpenClawAgents("not json at all")).toThrow();
  });

  it("treats empty output as an empty agent list", () => {
    expect(parseOpenClawAgents("")).toEqual([]);
  });
});

describe("findTopLevelJsonEnd", () => {
  it("finds the end of a top-level array ignoring a later unbalanced bracket", () => {
    const text = "[1,2,3]tail]";
    expect(findTopLevelJsonEnd(text, 0)).toBe(7);
  });

  it("returns -1 when the brackets never balance", () => {
    expect(findTopLevelJsonEnd("[1,2,3", 0)).toBe(-1);
  });

  it("skips over brackets inside string literals, including escaped quotes", () => {
    const text = String.raw`["a]b\"]c", 1]` + "trailing]";
    const end = findTopLevelJsonEnd(text, 0);
    expect(end).toBe(text.indexOf("trailing"));
    expect(() => JSON.parse(text.slice(0, end))).not.toThrow();
  });
});
