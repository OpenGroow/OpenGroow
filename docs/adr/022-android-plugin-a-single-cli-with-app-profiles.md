# ADR-022: Android Plugin — a single CLI with app profiles

**Status:** Accepted

### Context

The Social Engagement template needs to drive an Android phone (Instagram, and potentially TikTok, Twitter later). We had to decide the Plugin's granularity: a generic Android CLI + separate per-app plugins, or a single extensible Android CLI.

The agent interacts with the phone via three primitives (`observe`, `act`, `wait`). For Instagram, some actions are recurring and positional: like, comment, scroll. The temptation was to create a `plugins/instagram` with these named actions wrapping ADB.

### Decision

A **single Android Plugin** (`plugins/android`) with **JSON app profiles** (`profiles/instagram.json`, `profiles/tiktok.json`…).

The CLI exposes two levels:
1. **Generic primitives**: `act { type: "tap", x, y }`, `act { type: "swipe", direction }`
2. **Named per-profile actions**: `act { type: "tap_zone", app: "instagram", zone: "like", postIndex: 0 }`

Profiles describe UI zones relative to screen size (ratios and offsets). The CLI resolves `tap_zone` → absolute coordinates → humanized tap. Instagram knowledge is *data*, not code.

**Gesture humanization is an exclusive CLI responsibility**: random offset on taps, variable speed on swipes, letter-by-letter typing. The Agent does not know these mechanisms and does not configure them.

### Options considered

- **Separate `plugins/instagram`** wrapping ADB and exposing only Instagram actions. Rejected: duplicates the ADB/UIAutomator layer for each target app; adding TikTok would require a whole new package instead of one JSON file.
- **Purely generic CLI** (pixels only, no `tap_zone`). Rejected: forces the Agent to know Instagram's absolute coordinates — fragile across app updates and needlessly verbose in AGENTS.md.

### Consequences

- Adding support for a new app = creating `profiles/<app>.json` with its zones. No code to write.
- Coordinates in profiles are relative to screen resolution; the CLI adapts to `screen.width` / `screen.height` returned by `observe`.
- `observe` remains always generic (no app knowledge); it's AGENTS.md that documents how to interpret the Instagram UI tree.
- In V1, the Plugin is installed globally on the host Mac (`pnpm --filter @megaclaw/android link --global`) and always co-locates with the OpenClaw host node, whether Megaclaw is local or cloud.
