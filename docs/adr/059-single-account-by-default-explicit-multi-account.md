# ADR-059: Single-account by default, explicit multi-account setting

**Status:** Accepted (#716, parent #710). Refines ADR-029.

### Context

ADR-029 locks registration after the first account, but which policy applied was a constant (`REGISTRATION_POLICY`) rewritten by the OSS export script, which no longer exists. The login stays in self-host: the dashboard drives agents that run commands on the user's machine and a Docker-driving service, so an unauthenticated dashboard (or any website posting to `localhost`) could run code on the machine.

### Decision

1. **Single-account is the product default.** The policy is resolved at runtime by `resolveRegistrationPolicy(env.OPENGROOW_ACCOUNT_MODE)`. Only the exact value `multi-account` opens sign-up (hosted deployments). Unset, empty or misspelled values resolve to single-account: a misconfiguration fails closed ("locked"), and any non-empty unrecognised value logs an explicit warning (once per value). The variable belongs to the **Convex deployment** (`npx convex env set OPENGROOW_ACCOUNT_MODE multi-account`), not to the dashboard container; a hosted deployment must set it there. A misconfiguration fails closed ("locked"), which answers the earlier concern that a runtime flag is easier to misconfigure. The failure of the opposite design (default open, flag to lock) is the one ADR-029 already rejected.
2. **No startup token.** A Jupyter-style startup token (one-click login URL printed at boot, derived password, rotation, rate limit) was built and then removed: it added a route, a limiter, a secret in the container logs and a rotation procedure for little gain over the existing form. The email/password form of ADR-029 is the first-run path; the first account created becomes the sole administrator and later sign-ups are refused. An operator exposing a fresh dashboard on a network should create the account right after the first start.
3. **Identity stays neutral.** Business code reads the Convex identity (`tokenIdentifier`, `subject`); `auth.config.ts` can list further providers later. No new code assumes Better Auth as the only provider. An external provider adapter is not built here.
4. Google OAuth and `DASHBOARD_DEV_SKIP_AUTH` are removed: email/password is the only sign-in path.

### Alternatives considered

- Default `unlimited` with a flag to lock: rejected, open by default.
- Build-time constant per image: rejected, reintroduces a file rewritten per distribution.
- Startup token (Jupyter style): built, then removed for the reasons in Decision 2.

### Consequences

- A hosted multi-account deployment must set `OPENGROOW_ACCOUNT_MODE=multi-account` explicitly; forgetting it blocks new sign-ups rather than opening them.
