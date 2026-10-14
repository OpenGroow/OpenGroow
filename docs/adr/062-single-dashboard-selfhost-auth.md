# ADR-062: One dashboard; self-host keeps a login, with a frictionless first run

**Status:** Accepted (#722; implemented by #714, #715, #716, #717, spec #710). Refines ADR-029 and ADR-059.

## Context

A marketing landing and a hosted-only login lived beside the dashboard. A self-host user needs a working dashboard from `cp .env.example .env && pnpm dev` without configuring an identity provider.

## Decision

- **One dashboard.** `apps/landing` is deleted. The same dashboard serves self-host and the hosted offer. No capability system is introduced until the two genuinely diverge.
- **Self-host keeps its login.** The dashboard drives agents that run commands on the user's machine and a service that drives Docker; an unauthenticated dashboard (or any website posting to `localhost`) could run code there. Email and password, single account by default (ADR-059), locked after the first account. No startup token, no Google OAuth.
- **Identity stays neutral.** Business code reads the Convex identity (`tokenIdentifier`, `subject`). An external identity provider can be added later through `auth.config.ts` without rewriting business code. No adapter is built now.
- **Hosted multi-account** is the explicit setting `OPENGROOW_ACCOUNT_MODE=multi-account` on the Convex deployment; any other value fails closed.
- **One `.env`** at the repository root, two launch modes (`pnpm dev`, `pnpm start`), public dashboard URLs resolved at runtime.

## Alternatives considered

- **No login in self-host**: simplest first run, but unsafe for the reason above.
- **Separate self-host and hosted dashboards**: two UIs to keep in step for the same screens.
- **A unified login adapter now**: designed for a second provider that does not exist.

## Consequences

- A fresh install: open the dashboard, create the account, start. The first account is the sole administrator.
- A team wanting several self-hosted users has no supported mechanism yet (explicit gap, ADR-029).
- A unified login for the hosted offer is future work, designed with the cloud backend.
