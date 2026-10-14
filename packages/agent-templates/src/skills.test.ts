import { describe, expect, it } from "vitest";
import {
  findSkillByKey,
  getRequiredTemplateSkills,
  reconcileTemplateSkillsMirror,
  upsertSkillEntry,
  type ProjectAgentSkill,
} from "./skills";
import type { AgentManifest } from "./types";

function manifestWithSkills(skills: AgentManifest["skills"]): AgentManifest {
  return {
    id: "demo",
    name: "Demo",
    description: "",
    category: "demo",
    mcpServers: [],
    skills,
  };
}

describe("getRequiredTemplateSkills", () => {
  it("returns an empty array when the manifest declares no skills", () => {
    expect(getRequiredTemplateSkills(manifestWithSkills(undefined))).toEqual([]);
  });

  it("trims spec but does not lowercase or otherwise normalize it", () => {
    const skills = getRequiredTemplateSkills(
      manifestWithSkills([{ source: "clawhub", spec: "  Avoid-AI-Writing  " }]),
    );
    expect(skills).toEqual([{ source: "clawhub", spec: "Avoid-AI-Writing" }]);
  });

  it("de-duplicates entries with the same source + trimmed spec", () => {
    const skills = getRequiredTemplateSkills(
      manifestWithSkills([
        { source: "clawhub", spec: "avoid-ai-writing" },
        { source: "clawhub", spec: " avoid-ai-writing " },
      ]),
    );
    expect(skills).toEqual([{ source: "clawhub", spec: "avoid-ai-writing" }]);
  });
});

describe("reconcileTemplateSkillsMirror", () => {
  const now = 1_700_000_000_000;

  it("adds a fresh installed outcome for a Template with no prior skills", () => {
    const result = reconcileTemplateSkillsMirror(
      [],
      [{ source: "clawhub", spec: "avoid-ai-writing" }],
      [{ source: "clawhub", spec: "avoid-ai-writing", status: "installed" }],
      now,
    );
    expect(result).toEqual([
      { source: "clawhub", spec: "avoid-ai-writing", origin: "template", status: "installed", updatedAt: now },
    ]);
  });

  it("replaces the existing entry for the same source + spec instead of duplicating it", () => {
    const existing: ProjectAgentSkill[] = [
      { source: "clawhub", spec: "avoid-ai-writing", origin: "template", status: "installed", updatedAt: now - 1000 },
    ];
    const result = reconcileTemplateSkillsMirror(
      existing,
      [{ source: "clawhub", spec: "avoid-ai-writing" }],
      [{ source: "clawhub", spec: "avoid-ai-writing", status: "installed", version: "1.2.0" }],
      now,
    );
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      source: "clawhub",
      spec: "avoid-ai-writing",
      origin: "template",
      status: "installed",
      updatedAt: now,
      version: "1.2.0",
    });
  });

  it("records a failed outcome with its errorMessage instead of dropping the entry", () => {
    const result = reconcileTemplateSkillsMirror(
      [],
      [{ source: "clawhub", spec: "avoid-ai-writing" }],
      [{ source: "clawhub", spec: "avoid-ai-writing", status: "error", errorMessage: "install failed: 404" }],
      now,
    );
    expect(result).toEqual([
      {
        source: "clawhub",
        spec: "avoid-ai-writing",
        origin: "template",
        status: "error",
        updatedAt: now,
        errorMessage: "install failed: 404",
      },
    ]);
  });

  it("removes an origin:template entry no longer declared by the Template", () => {
    const existing: ProjectAgentSkill[] = [
      { source: "clawhub", spec: "avoid-ai-writing", origin: "template", status: "installed", updatedAt: now - 1000 },
      { source: "clawhub", spec: "stale-skill", origin: "template", status: "installed", updatedAt: now - 1000 },
    ];
    const result = reconcileTemplateSkillsMirror(
      existing,
      [{ source: "clawhub", spec: "avoid-ai-writing" }],
      [{ source: "clawhub", spec: "avoid-ai-writing", status: "installed" }],
      now,
    );
    expect(result.map((s) => s.spec)).toEqual(["avoid-ai-writing"]);
  });

  it("leaves origin:user entries untouched even when not in requiredSkills", () => {
    const existing: ProjectAgentSkill[] = [
      { source: "clawhub", spec: "user-added-skill", origin: "user", status: "installed", updatedAt: now - 1000 },
    ];
    const result = reconcileTemplateSkillsMirror(existing, [], [], now);
    expect(result).toEqual(existing);
  });
});

describe("findSkillByKey (issue #224)", () => {
  it("finds an entry by source + spec regardless of origin", () => {
    const skills: ProjectAgentSkill[] = [
      { source: "clawhub", spec: "avoid-ai-writing", origin: "template", status: "installed", updatedAt: 1 },
    ];
    expect(findSkillByKey(skills, "clawhub", "avoid-ai-writing")).toEqual(skills[0]);
  });

  it("returns undefined when no entry matches", () => {
    expect(findSkillByKey([], "clawhub", "missing-skill")).toBeUndefined();
  });
});

describe("upsertSkillEntry (issue #224)", () => {
  it("appends a new entry when no existing entry shares its source + spec", () => {
    const entry: ProjectAgentSkill = { source: "clawhub", spec: "new-skill", origin: "user", status: "installed", updatedAt: 1 };
    expect(upsertSkillEntry([], entry)).toEqual([entry]);
  });

  it("replaces the existing entry for the same source + spec instead of duplicating it", () => {
    const existing: ProjectAgentSkill[] = [
      { source: "clawhub", spec: "my-skill", origin: "user", status: "error", updatedAt: 1, errorMessage: "boom" },
    ];
    const replacement: ProjectAgentSkill = { source: "clawhub", spec: "my-skill", origin: "user", status: "installed", updatedAt: 2 };
    const result = upsertSkillEntry(existing, replacement);
    expect(result).toEqual([replacement]);
  });
});
