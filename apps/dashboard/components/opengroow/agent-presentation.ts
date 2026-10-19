import type { StatusTone } from "@/components/opengroow/status-badge"

// Single source for how an Agent looks in the catalogue: tone by category,
// initials from the name and the short card description. Presentation only;
// the full technical description stays on the Agent's own page.
export type AgentTone = "creative" | "research" | "engagement" | "visual" | "neutral"

// Full class names, so Tailwind can see them. Tokens live in globals.css.
export const AGENT_TONE_CLASSES: Record<AgentTone, string> = {
  creative: "bg-tone-violet-soft text-tone-violet glow-tone-violet",
  research: "bg-tone-cyan-soft text-tone-cyan glow-tone-cyan",
  engagement: "bg-tone-green-soft text-tone-green glow-tone-green",
  visual: "bg-tone-blue-soft text-tone-blue glow-tone-blue",
  neutral: "bg-tone-slate-soft text-tone-slate",
}

// The tone follows the Template's category, never the individual Agent.
const CATEGORY_TONES: Record<string, AgentTone> = {
  marketing: "creative",
  social: "engagement",
  system: "research",
}

export function agentTone(category: string | undefined): AgentTone {
  return CATEGORY_TONES[category?.trim().toLowerCase() ?? ""] ?? "neutral"
}

/** "MoneyPrinterTurbo Agent" -> "MP", "SEO Agent" -> "SE", "Source" -> "SO". */
export function agentInitials(name: string): string {
  const words = name
    .replace(/\bagent\b/gi, " ")
    .split(/[\s_-]+/)
    .flatMap((word) => word.match(/[A-Z]?[a-z0-9]+|[A-Z]+(?![a-z])/g) ?? [])
    .filter(Boolean)
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase()
  const only = words[0] ?? name.trim()
  return only.slice(0, 2).toUpperCase() || "?"
}

export const AGENT_STATUS: Record<"inactive" | "activating" | "active" | "error", { label: string; tone: StatusTone }> = {
  inactive: { label: "Inactive", tone: "info" },
  activating: { label: "Activating", tone: "progress" },
  active: { label: "Active", tone: "active" },
  error: { label: "Error", tone: "error" },
}

// Short descriptions, keyed by the Template id's slug (`@scope/slug` ->
// `slug`) so a Template republished under another scope keeps its text.
// Renamed slugs are aliases. Absent = fall back to the manifest description.
const MONEYPRINTERTURBO = "Creates short-form videos from a single prompt."
const OPENMONTAGE = "Turns storyboards into finished videos."
const ENGAGEMENT = "Discovers and engages with relevant social posts."

const SHORT_DESCRIPTIONS: Record<string, string> = {
  moneyprinterturbo: MONEYPRINTERTURBO,
  "moneyprinterturbo-agent": MONEYPRINTERTURBO,
  openmontage: OPENMONTAGE,
  "openmontage-agent": OPENMONTAGE,
  seo: "Researches keywords and creates SEO content.",
  engagement: ENGAGEMENT,
  "social-engagement": ENGAGEMENT,
  source: "Evaluates opportunities and routes them to agents.",
  "video-demo": "Produces product demos and marketing videos.",
  "visual-social": "Creates branded carousels for social media.",
}

export function agentShortDescription(templateId: string): string | undefined {
  const slug = (templateId.split("/").pop() ?? templateId).trim().toLowerCase()
  return SHORT_DESCRIPTIONS[slug]
}

/** "marketing" -> "Marketing": categories are free-form template strings. */
const ACRONYMS = new Set(["seo", "ai", "crm", "api"])

export function formatCategory(category: string): string {
  const value = category.trim()
  if (ACRONYMS.has(value.toLowerCase())) return value.toUpperCase()
  return value ? value[0].toUpperCase() + value.slice(1) : value
}
