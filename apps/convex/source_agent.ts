// Issue #584, ADR-052: the generic `source` Agent Template — every Project
// activates it once, independently of which Template(s) actually produce
// Sources. Its id lives here, its own dedicated one-export module, rather
// than in `sources_social.ts` (which stays social-specific) — scoring and
// routing dispatch onto this Agent whichever origin the Source came from.
export { SOURCE_AGENT_TEMPLATE_ID as SOURCE_TEMPLATE_ID } from "@opengroow/agent-templates";
