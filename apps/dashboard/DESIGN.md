# OpenGroow — Midnight Design System

Version: 1.2 — October 2026
Status: implemented on the dashboard, with the Agents page as the visual reference; validate each new page against it.

## 1. Product identity

OpenGroow is an open-source growth orchestration platform where specialized AI agents discover opportunities, execute jobs, and coordinate repeatable marketing work.

The UI should feel like a **premium developer tool and a calm mission-control workspace**, not a sci-fi cockpit, CRM template, or glowing crypto dashboard.

Design DNA:
- **Linear:** restrained information density, strong navigation, efficient tables and list rows.
- **Raycast:** occasional luminous blue/violet accents, premium depth, expressive but sparing animation.
- **Supabase:** legible technical forms, status indicators, console-like job details, dependable admin patterns.

These are inspirations, not copied proprietary assets or brand identities.

## 2. Source of truth

- `globals.css` is the **only source of truth for visual token values**. Never duplicate hex values or fixed radii into this document or individual page components.
- Prefer existing `components/ui/*` primitives (shadcn/ui) before creating new primitives.
- Place product-specific composites in `components/opengroow/*`. Shared building blocks that exist today, to reuse before writing anything new: `page-header.tsx` (title block of every page), `status-badge.tsx` (every status), `filter-bar.tsx` (filter chips and search), `stat-tile.tsx` (aggregates backed by real data), `agent-card.tsx` / `agent-avatar.tsx` / `agent-presentation.ts` (agent look), `mission-status.ts` (Mission and Run status labels).
- Use semantic Tailwind utilities: `bg-background`, `bg-card`, `text-foreground`, `text-muted-foreground`, `border-border`, `bg-primary`.
- Use `dark` as the default product appearance; the provided `.light` palette is an optional future mode.
- Do not hardcode Tailwind palette names like `bg-slate-900` or `text-blue-500`, nor hex/rgba values, arbitrary radii or shadows, in product views when a semantic token exists. `className` on a primitive is for layout only (`w-fit`, `ml-auto`); colours and sizes come from its variants.

## 3. Core visual principles

1. **Calm first.** Users should recognize the current state within two seconds.
2. **Information over ornament.** Each widget must answer a user question or enable an action.
3. **Progressive disclosure.** Detailed logs, metadata, and advanced settings belong in detail views or expandable sections.
4. **One focal point per view.** A single primary action and at most one dominant visual region.
5. **Reusable semantic status.** Color must be backed by label, icon, or text (not color alone).
6. **Subtle depth.** Default surfaces rely on small luminance shifts and borders, not shadows on every card.
7. **Special effects are rare.** Glow is only for an important running state, high-value call to action, or selected spotlight module; never for every card.
8. **Colour roles.** Each colour has one job; none is decorative or random.
   - **Blue** (`primary`): actions, navigation and selection (buttons, pressed filter). Never used for status.
   - **Green** (`tone-green`): active and successful states, and nothing else. One green only.
   - **Cyan** (`tone-cyan`): work in progress, and research/data agents.
   - **Violet** (`tone-violet`): creative agent identity (marketing category).
   - **Amber** (`status-warning`): warnings and states waiting for a human.
   - **Red** (`status-error`, `destructive`): errors and destructive actions.
   - **Slate** (`tone-slate`): neutral, paused or unknown.
   The tone palette (`--color-tone-*` and `-soft`) is authored in `globals.css`.

## 4. Layout and navigation

- Persistent left navigation on desktop; collapsible drawer on small screens.
- Stable shell: Sidebar / page header / page content.
- Typical desktop content width: flexible, with comfortable horizontal padding; avoid arbitrarily narrow tables.
- Page header: `PageHeader` (large bold title, one-line description, one primary action at upper right). No eyebrow label above the title. A faint spotlight (`glow-hero`) sits behind it, drawn once by the app shell, never by pages.
- Never duplicate a global search box in every panel.
- Use 8px-based rhythm where possible; rely on shared Tailwind spacing utilities.
- Lists/tables are preferred for operational objects with many rows; cards are preferred for discoverable entities like agents and sources.
- Sidebar should be distinct but not visually louder than the content. Active nav uses a tinted surface, small marker, and clear text.

### Navigation taxonomy

- Home: overview only; no redundant welcome message.
- Missions: goals, outcomes, review and progress.
- Agents: discover/manage specialized agents.
- Sources: monitor and connect information sources.
- Jobs: discrete executions, logs and retries.
- Scheduler: recurring jobs and their execution rules, **not** a calendar.
- Brand: structured **textual brand context**, not an invented logo/asset studio.
- Settings: configuration, integrations and account.

## 5. Typography and hierarchy

- Main font: Inter (with system sans fallback). Monospace for IDs, cron expressions, timestamps and log fragments.
- Use a compact SaaS scale built on Tailwind sizes only (no arbitrary `rem`): page title `text-4xl sm:text-5xl` bold; page description `text-lg sm:text-xl`; section and card titles `text-lg`/`text-xl` semibold; body `text-base`; labels and metadata `text-sm`; badges `text-xs`.
- Components are comfortable, not tiny: control height 40px (`default`), 44px for primary and filter controls (`lg`), 32px for dense rows (`sm`); nav items 40px.
- Avoid oversized marketing headlines inside the app.
- Keep labels consistent; prefer sentence case over all caps.
- Use tabular numerals for counters and timestamps.
- Avoid low-contrast text on dark surfaces, especially for long descriptions.

## 6. Components

### Buttons

- `default`: one high-signal action in each screen or modal.
- `glow`: the single featured call to action of a page (e.g. Add Agent); a very light glow, never default.
- `accent`: a blue outlined action with a glow only on hover.
- `secondary`: routine non-destructive actions.
- `outline`: low-emphasis alternative and filter chips (`aria-pressed` gives the soft blue selection, no glow).
- `ghost`: icon actions, toolbars, row menus.
- `destructive`: deletion or irreversible changes.
- Sizes: `xs` 28px, `sm` 32px, `default` 40px, `lg` 44px; icon sizes follow. Use the `loading` prop for pending actions.
- All buttons require hover, focus-visible, disabled and loading states. Never use a raw `<button>`, `<input>`, `<textarea>` or `<select>`.

### Cards

- `Card` is the only panel: `rounded-2xl`, neutral surface, a 1px neutral ring, no shadow and no coloured border. Panels, list rows and sections use it; do not rebuild `rounded border bg-*` containers by hand. Avoid cards nested three levels deep.
- **Agent card** (reference: Agents page): initials avatar, name and a small `StatusBadge` on the first row; a short description on 2 lines at most; the action at the bottom right. All cards in a grid keep the same height whatever the state. An active Agent's whole card is the link to its page (the name is a stretched link), so it has no Open button; inactive Agents keep `Activate` / `Retry`.
- **Avatar**: no per-agent icon. Show 1-2 initials in upper case on a tone chosen by the Template category (marketing -> violet, social -> green, system -> cyan, anything else -> slate). Do not assign unique decorative icons or random colours to individual agents or jobs.
- **Category** appears as a filter, not as a tag on each card. Catalogue cards use a short description; detail pages keep the full one.
- Aggregates use `StatTile` and only when backed by real data.

### Tables and operational lists

- Prefer Jobs and Schedules as scannable rows.
- Left-aligned job name; status and last run/time aligned predictably.
- Row hover subtle; actions only when relevant.
- Offer loading skeletons, empty states, error handling and pagination for long lists.
- Logs use monospace and can be expanded or opened in a detail panel.

### Forms

- Favor labels above inputs; placeholders are supplemental, not labels.
- Full keyboard accessibility, visible focus ring, inline validation and helpful error messages.
- Group related advanced settings in expandable panels.
- Toggles represent immediate on/off state; use explicit save actions for forms with several editable fields.
- Sliders only when a range is meaningful; do not use sliders for cron schedules or exact numeric configuration requiring precision.

### Status vocabulary

Every status is a `StatusBadge`: a small tinted pill (border and dot carry the colour, the label stays light). Tones:
- `active`: green. Active agent, ready or completed work, published.
- `progress`: cyan, with a pulsing dot. A process is running (Mission in progress, Run running, Source processing).
- `info`: blue. Inactive, or a stage that is neither good nor bad (Source ready/scored/routed).
- `warning`: amber. Waiting for a human (To validate, Blocked).
- `error`: red.
- `neutral`: grey. Paused, queued, stopped, unavailable.
A badge always contains human-readable text, never a raw enum value; labels come from the glossary (`mission-status.ts`, `agent-presentation.ts`). The generic `Badge` (default, secondary, outline, tag) is only for non-status labels.

## 7. Screen-specific composition

### Home

A restrained operational overview, not another Missions page.
- Show a compact performance/growth pulse module **if meaningful data exists**.
- Show a refined **Recent Activity** feed with timestamp, event, involved agent/source, outcome and navigable detail.
- Show only other aggregate sections supported by real data, with generous space and no filler.
- Explicitly avoid: Good Morning greeting, Agent Working Now, Channel Health, Quick Actions, Today's Schedule, Tips & Insights, and Needs Your Attention sections (removed during design exploration).

### Agents

- `PageHeader` with the single glowing `Add Agent` action, two stat tiles (active and installed agents), filter chips (All, Active, then the categories present) with a search field, then a 2-column (3 on very wide screens) grid of agent cards.
- Agent details and metrics appear after navigation into that agent, not in every card.

### Sources

- Separate configured sources from available integrations.
- Show recognizable provider icon when available, generic fallback otherwise.
- Connection status and last sync/scan are useful; avoid promotional copy.

### Jobs

- Compact table/list first: job, associated agent, state, started/ended, duration, row action.
- Details contain logs, outputs, errors, retries and metadata.
- Avoid oversized cards or unique icon requirements per job.

### Scheduler

- This is **repeat-job orchestration**, not an event calendar.
- Primary list: recurring job name, linked agent/job, recurrence (human-friendly plus optional cron), next run, last run, active/paused status.
- Create/edit schedule form: name, target, cadence, timezone, enabled toggle, optional advanced cron expression.
- Show invalid cron expressions and timezone handling explicitly.

### Brand

- Brand context is currently **text-only**.
- Structured textareas: business/product summary, target audience, voice/tone, positioning, editorial guidance, exclusions/constraints.
- Save/reset states and unsaved-change feedback.
- Do not invent a visual brand kit, logo manager, or asset uploader unless the product genuinely supports those features.

## 8. Interaction and motion

- Default interactions are fast and quiet: subtle color/border transitions.
- Respect `prefers-reduced-motion`.
- Glow and pulse are reserved for intentional activity indicators and special moments.
- Use `glow-primary` (very light) for a singular featured CTA, `glow-hover` for interactive cards (on hover or focus only), and `glow-hero` for the shell's faint, diffuse spotlight, never operational tables or regular forms. `glow-active` stays available for a focused live surface but is not used on agent cards.
- The glow utilities are authored in `globals.css`; do not recreate the shadows with hardcoded inline colors.
- Avatar halo: `glow-tone-violet|cyan|green|blue` give an agent avatar a faint halo (they ride on `AGENT_TONE_CLASSES` in `components/opengroow/agent-presentation.ts`). They are deliberately faint and authored in `globals.css` from the `--color-tone-*` tokens; never on tables, forms or whole cards. Initials, status badges and dots carry no glow, and the accent button only glows on hover.
- Respect `prefers-reduced-motion`; never use a continuous animated glow as the only activity indicator.
- Never animate entire data tables continuously.
- Distinguish loading, empty, failed and successful operations without relying only on motion.

## 9. Responsiveness and accessibility

- Keyboard navigation across menus, dialogs, tables and forms.
- Visible focus state via semantic `ring` token.
- Aim for WCAG AA text contrast; test actual combinations before production release.
- Mobile: sidebar drawer, stacked forms, compact card lists, horizontal scrolling for truly dense operational tables.
- Avoid hiding mission-critical information behind hover-only interactions.

## 10. Rules for AI coding agents

When implementing or updating OpenGroow UI:

1. Read this file, `globals.css`, and existing `components/ui/*` before making changes.
2. Do not create new colors or one-off radii unless the design system is intentionally extended.
3. Reuse existing components and their variants; extend primitives centrally if needed. A new page starts from `PageHeader`, `Card`, `StatusBadge`, `FilterChips`/`SearchField` and the `ui` controls.
4. Do not add new Home widgets without a real product requirement and real data.
5. Honor each page's data model (Scheduler = recurring jobs; Brand = textual context).
6. Avoid placeholder business metrics masquerading as real numbers.
7. Check dark mode, keyboard focus, empty/loading/error states and narrow viewports.
8. Compare visual output against the approved OpenGroow mockups and iterate for density and restraint.
9. Keep documentation aligned whenever a new token or shared component is introduced.

## 11. Visual review checklist

- Is the view easier to scan than before?
- Could one card, border, badge, icon or widget be removed?
- Is there exactly one obvious primary action?
- Does every displayed metric have a real data source?
- Are colors and spacing drawn from shared tokens?
- Does the UI still work without unique custom icons?
- Are focus, empty, loading, error and disabled states handled?
