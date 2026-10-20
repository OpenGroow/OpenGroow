import {
  agentInitials,
  agentTone,
  AGENT_TONE_CLASSES,
} from "@/components/opengroow/agent-presentation"
import { cn } from "@/lib/utils"

// Initials on a tone chosen by the Template's category (marketing, social,
// system, ...): no per-agent icon or colour to maintain.
function AgentAvatar({
  name,
  category,
  className,
}: {
  name: string
  category?: string
  className?: string
}) {
  return (
    <span
      data-slot="agent-avatar"
      aria-hidden="true"
      className={cn(
        "inline-flex size-14 shrink-0 items-center justify-center rounded-xl text-xl sm:size-18 sm:rounded-2xl sm:text-2xl font-bold tracking-wide",
        AGENT_TONE_CLASSES[agentTone(category)],
        className
      )}
    >
      {agentInitials(name)}
    </span>
  )
}

export { AgentAvatar }
