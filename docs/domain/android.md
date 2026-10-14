# Android Plugin

Part of the OpenGroow glossary: see [GLOSSARY.md](../../GLOSSARY.md) for the vision, bounded contexts and term index.

### Android Plugin

Local extension co-installed on the Mac host of the OpenClaw Instance. An Android Plugin exposes a bounded CLI (`opengroow-android`) that the Agent invokes via `system.run`. It is not part of the OpenGroow cloud infrastructure — it always runs on the machine where the phone is plugged in.

- An Android Plugin includes: a TypeScript CLI (entrypoint), a Python engine (ADB + UIAutomator), and **app profiles** (UI zone data per application).
- **The CLI only exposes semantic actions to the Agent.** Physical gestures (`tap`, `double_tap`, `swipe`, `tap_by_desc`…) are internal implementation details. The Agent calls intentions (`like`, `next_post`, `navigate_to_reels`…); the CLI resolves the gesture via the app profile. The Agent never knows the underlying physical mechanism. `tap_by_desc` is a gesture that targets an element by its UIAutomator `content-desc` rather than by coordinates — more stable when the screen layout varies.
- **App profiles** (`profiles/instagram.json`, `profiles/tiktok.json`) declare, for each semantic action, the physical gesture to execute and its parameters. This is *data*, not code — adding support for a new app = adding a profile file.
- The CLI is responsible for humanizing gestures: random offset on taps, variable speed on swipes, letter-by-letter typing. The Agent does not know these mechanisms.
- The Plugin is installed globally on the Mac (built and `npm link`ed from its own repository, `private-groowhub` `tools/android`, see its README) and available in the host node's PATH.
- `observe` always returns a `screenshotPath` (file saved in `--output-dir`) + the filtered UIAutomator elements (text and clickables only). `act` always returns a post-action screenshot.
- _Avoid_: "Android MCP", "Android server", "official OpenClaw Android node" (the Plugin is neither an MCP server nor an OpenClaw node).
