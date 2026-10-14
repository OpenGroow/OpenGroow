import { CircleAlert } from "lucide-react";
import type { ProjectAgentSkill } from "@convex/template_manifest_contract";
import { cn } from "@/lib/utils";

type AgentSkillsListProps = {
  skills: ProjectAgentSkill[];
  selectedSpec?: string | null;
  onSelectSkill?: (spec: string) => void;
};

const SPEC_LABEL_CLASS = "font-medium text-[var(--dashboard-ink)]";

/**
 * Compact list of persisted Agent Skills (`projectAgents.skills[]`), showing
 * whether each was required by the Template or added by the user, and
 * surfacing per-skill install errors (issue #224). Purely a UI mirror — the
 * OpenClaw workspace remains the execution source of truth.
 *
 * Clicking a skill (when `onSelectSkill` is provided) triggers an on-demand
 * listing of that skill's files in the workspace, rather than eagerly
 * scanning every skill folder up front.
 */
export function AgentSkillsList({ skills, selectedSpec, onSelectSkill }: AgentSkillsListProps) {
  if (skills.length === 0) return null;

  return (
    <ul className="m-0 grid list-none gap-2 p-0">
      {skills.map((skill) => (
        <li
          key={`${skill.source}:${skill.spec}:${skill.origin}`}
          className={cn(
            "flex flex-wrap items-center gap-2 rounded-lg px-3 py-2 text-[0.85rem] text-[var(--dashboard-ink-muted)] transition-colors duration-150",
            selectedSpec === skill.spec
              ? "bg-[linear-gradient(135deg,rgba(188,237,215,0.92),rgba(214,236,226,0.88))]"
              : "bg-[rgba(0,38,27,0.04)]",
          )}
        >
          {onSelectSkill ? (
            <button
              type="button"
              onClick={() => onSelectSkill(skill.spec)}
              className={cn(SPEC_LABEL_CLASS, "hover:underline")}
            >
              {skill.spec}
            </button>
          ) : (
            <span className={SPEC_LABEL_CLASS}>{skill.spec}</span>
          )}
          <span className="rounded-full bg-[rgba(220,230,224,0.6)] px-2 py-0.5 text-[0.68rem] font-bold uppercase tracking-[0.1em] text-[var(--dashboard-ink-soft)]">
            {skill.origin === "template" ? "Required" : "Added by you"}
          </span>
          {skill.status === "error" ? (
            <span className="flex items-center gap-1 text-[0.8rem] text-[var(--dashboard-tertiary)]">
              <CircleAlert className="size-3.5" />
              {skill.errorMessage ?? "Install failed"}
            </span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
