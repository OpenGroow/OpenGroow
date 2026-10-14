# ADR-042: Adding TikTok to Social Engagement requires generalizing the Android Plugin engine first

**Status:** Accepted

### Context

ADR-022 decided the Android Plugin's shape: a single generic CLI plus a JSON app profile per target app, so that "adding support for a new app = creating `profiles/<app>.json`... No code to write." Extending Social Engagement to TikTok is the first real test of that claim.

Auditing `plugins/android/engine/main.py` against that claim found it does not hold today: the target package name (`com.instagram.android`) and several fallback resource-id lists used for account verification and Reels detection are hardcoded directly in the Python engine in roughly fifteen places, not read from the app profile. The TypeScript side (`engine.ts`, `cli.ts`) is already generic — it loads `profiles/<app>.json` by name via `--app` — but the Python engine it drives is not. This drift happened incrementally as Instagram-specific bugs were fixed (see the `_note` fields in `profiles/instagram.json`, e.g. issue #270) without anyone revisiting the ADR-022 contract.

Writing `profiles/tiktok.json` today, as ADR-022 implies is sufficient, would not work: the engine would still target `com.instagram.android` and Instagram-only fallback selectors regardless of the profile passed.

### Decision

Split the TikTok work into two dependent pieces of work:

1. **Generalize the Android Plugin engine first**, with no behavior change for Instagram: `main.py` reads `packageName` and fallback resource-id lists from the loaded app profile instead of hardcoding Instagram's; `engine.ts`'s `InstagramSemanticAction` type is renamed to a platform-neutral name. Regression-tested against the existing Instagram profile before any TikTok-specific work starts.
2. **Add TikTok support** on top of the generalized engine: a new `profiles/tiktok.json` (built from resource-id and account-switch behavior measured on a real device, not assumed), and the `social-engagement` Agent Template generalized to take a `platform` requirement instead of being Instagram-only in its prompt and blocker code.

### Consequences

- ADR-022's "no code to write" consequence is corrected: it only holds once the engine actually sources per-app identity from the profile, which is not yet the case for the fields enumerated above.
- Instagram's own behavior must not regress from the engine generalization — same fallback resource-ids, same package name, just sourced from `profiles/instagram.json` instead of literals.
- Future third apps (e.g. Twitter, cited in ADR-022) benefit from the same generalized engine without repeating this two-step split.
