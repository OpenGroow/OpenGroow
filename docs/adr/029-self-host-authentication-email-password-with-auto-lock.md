# ADR-029: Self-host authentication — email/password with auto-lock after first account

**Status:** Accepted

### Context

The OSS self-hosted deployment (issue #261) needs a login from first boot: an unauthenticated dashboard would let anyone who reaches the port drive AI agents on the self-hoster's machine. The SaaS dashboard's existing sign-in entrypoint (`SignInButton`, the onboarding wizard's `StepAuth`) lives only in `apps/landing`, which is excluded from the OSS subset — `apps/dashboard` only ever consumed an existing session and never rendered its own login page. SaaS auth also requires Google OAuth, which requires the operator to register their own OAuth app — an unacceptable setup step for someone trying `docker compose up` for the first time.

A self-hosted instance is single-tenant by construction (ADR-028): exactly one Project, run by one operator. There's no multi-user account model to build, but there is a real risk window: between the container starting and the operator's first visit, a stranger who reaches the dashboard first could create the account and lock the real operator out of their own Project.

### Decision

Add email/password sign-up to `apps/dashboard` via Better Auth's `emailAndPassword` plugin with `requireEmailVerification: false` — no SMTP/Resend dependency needed to create an account. The sign-in entrypoint is relocated/duplicated from `apps/landing` into `apps/dashboard`, which gains its own login/sign-up page.

Registration **locks automatically after the first account is created** — the first successful sign-up becomes the sole admin, and every subsequent sign-up attempt is rejected with a clear error until a reopening mechanism exists (out of scope for #261). This is enforced by a pure decision function (given 0 vs 1 existing accounts) that is unit-tested directly, without needing to drive a real auth flow in tests.

Google OAuth remains available as an optional provider, unchanged from the existing SaaS code path — a self-hoster who *has* registered an OAuth app can still use it.

**Alternatives considered:**

- An opt-in `DISABLE_REGISTRATION` flag (the Postiz pattern) — rejected because it's open by default: a self-hoster who forgets to set it ships an instance anyone can claim. Auto-lock after the first account needs no flag to remember.
- Requiring email verification — rejected because it forces an SMTP/Resend dependency onto a self-hoster whose entire goal is to avoid configuring external infrastructure just to start using their own instance.

### Consequences

- A self-hoster can create their account and reach a working dashboard with zero external dependencies (no OAuth app, no email provider).
- The registration race (stranger vs. operator on first boot) is narrowed to "whoever loads the page first," same as most self-hosted single-admin tools — acceptable given the deployment is meant to run on infrastructure the operator controls network access to.
- A team wanting multiple self-hosted users has no supported reopening mechanism yet; this is an explicit gap, not an oversight.
- SaaS auth behavior (`apps/landing`, Google-only entrypoint) is untouched — this is an additive path for the OSS dashboard, not a replacement.
