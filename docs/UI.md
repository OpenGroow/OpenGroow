**Icons**: always use `lucide-react`. Never create inline SVG components or custom icon functions. Choose the lucide icon closest in meaning.

**Components**: primitives are shadcn components (style `base-nova`, see `apps/dashboard/components.json`) in `apps/dashboard/components/ui/` (button, badge, card, dialog, input, label, native-select, select, switch, textarea). Reuse them before writing a new one, and merge class names with `cn` from `@/lib/utils`.

**Styling**: Tailwind CSS v4. `apps/dashboard/app/globals.css` is the only source of truth for visual tokens (Midnight design system, dark by default; the `<html>` element carries `dark`). Follow `apps/dashboard/DESIGN.md`. Use the semantic utilities (`bg-background`, `bg-card`, `text-muted-foreground`, `border-border`, `bg-primary`, `bg-status-*`) and never hard-code hex/rgba values, Tailwind palette names (`stone`, `red`, ...), arbitrary radii or shadows. Glow is an exception reserved for `glow-*` utilities.

**Language**: all UI text is English (ADR 016, `docs/adr/016-ui-language-all-english.md`).

**Vocabulary**: speak the business language of `GLOSSARY.md`: Project, Agent, Mission, Run, Artifact. Never surface infrastructure words (Instance, Command, Event, job ids, WebSocket) to the user; see "What the user never sees" in `GLOSSARY.md`.

**Status display**: show statuses with `Badge` (`components/ui/badge.tsx`) and its status variants (`running`, `success`, `warning`, `error`, `paused`, `queued`), passing the user-facing label of the glossary (for example Mission statuses), never the raw enum value. A badge always carries text, never colour alone.

**Controls**: never use raw `<button>`, `<input>`, `<textarea>` or `<select>` for product UI. Use `Button` (variants `default`, `secondary`, `outline`, `ghost`, `destructive`, `link`, `glow`; `loading` prop), `Input`, `Textarea`, `NativeSelect` / `Select`. Extend the primitive's variants centrally instead of overriding colours with `className`; `className` is for layout only (`w-fit`, `ml-auto`, ...).

**Agent catalogue look**: an Agent card shows initials (from the name, upper-case) on a tone chosen by the Template's category (marketing, social, system; anything else is neutral), plus a short description; no per-agent icon. Everything comes from `apps/dashboard/components/opengroow/agent-presentation.ts`. Short descriptions are keyed by the Template id's slug (`@scope/seo` -> `seo`), are for catalogue cards only, and fall back to the manifest description; detail pages keep the full one. Tones are the `agent-*` tokens of `globals.css`. Cards stay neutral (no coloured border, no permanent glow); the state is a tinted `StatusBadge` pill (`components/opengroow/status-badge.tsx`: Active green, Inactive blue, Activating cyan, Error red) with a coloured dot and a light label.

**Shared page blocks**: every page starts with `PageHeader` (`components/opengroow/page-header.tsx`); panels and list rows are `Card`; every status is a `StatusBadge` with labels from `mission-status.ts` or `agent-presentation.ts`; list filters use `FilterChips` and `SearchField`. See `apps/dashboard/DESIGN.md` for sizes, colour roles and the Agents page used as the visual reference.
