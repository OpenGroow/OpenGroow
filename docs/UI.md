**Icons**: always use `lucide-react`. Never create inline SVG components or custom icon functions. Choose the lucide icon closest in meaning.

**Components**: primitives are shadcn components (style `base-nova`, see `apps/dashboard/components.json`) in `apps/dashboard/components/ui/` (button, card, dialog, input, label, select, switch, textarea, `status-pill`). Reuse them before writing a new one, and merge class names with `cn` from `@/lib/utils`.

**Styling**: Tailwind CSS v4. Theme variables are in `apps/dashboard/app/globals.css` and `app/dashboard-theme.css`; use the variables rather than hard-coded colours.

**Language**: all UI text is English (ADR 016, `docs/adr/016-ui-language-all-english.md`).

**Vocabulary**: speak the business language of `GLOSSARY.md`: Project, Agent, Mission, Run, Artifact. Never surface infrastructure words (Instance, Command, Event, job ids, WebSocket) to the user; see "What the user never sees" in `GLOSSARY.md`.

**Status display**: show statuses with the shared `StatusPill` (`components/ui/status-pill.tsx`), passing the user-facing label of the glossary (for example Mission statuses) and tone classes, never the raw enum value.
