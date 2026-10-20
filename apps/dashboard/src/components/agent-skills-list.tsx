import { CircleAlert } from "lucide-react";
import type { ProjectAgentSkill } from "@convex/template_manifest_contract";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

type AgentSkillsListProps = {
  skills: ProjectAgentSkill[];
  selectedSpec?: string | null;
  onSelectSkill?: (spec: string) => void;
};

const SPEC_LABEL_CLASS = "font-medium text-foreground";

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
            "flex flex-wrap items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors duration-150",
            selectedSpec === skill.spec
              ? "bg-primary/15"
              : "bg-muted",
          )}
        >
          {onSelectSkill ? (
            <Button
              type="button"
              variant="link"
              onClick={() => onSelectSkill(skill.spec)}
              className={cn(SPEC_LABEL_CLASS, "h-auto p-0")}
            >
              {skill.spec}
            </Button>
          ) : (
            <span className={SPEC_LABEL_CLASS}>{skill.spec}</span>
          )}
          <Badge>
            {skill.origin === "template" ? "Required" : "Added by you"}
          </Badge>
          {skill.status === "error" ? (
            <span className="flex items-center gap-1 text-xs text-destructive">
              <CircleAlert className="size-3.5" />
              {skill.errorMessage ?? "Install failed"}
            </span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
