// Registration policy (#716 / ADR-059, successor to the constant of ADR-029).
// The product default is "single-account" (self-host: the first sign-up
// becomes the sole admin, see auth_registration_lock.ts). A hosted
// multi-account deployment opts in explicitly with the exact value
// `OPENGROOW_ACCOUNT_MODE=multi-account`. Anything else, including a typo or
// an unset variable, resolves to the safe single-account policy: the failure
// mode of a misconfiguration is "locked", never "open to everyone".
export type RegistrationPolicy = "unlimited" | "single-account";

export const MULTI_ACCOUNT_MODE = "multi-account";

const warned = new Set<string>(); // auth is built per request: warn once per value

// OPENGROOW_ACCOUNT_MODE is a variable of the *Convex deployment* (set with
// `npx convex env set OPENGROOW_ACCOUNT_MODE multi-account`), not of the
// dashboard container. A typo still fails closed, but never silently.
export function resolveRegistrationPolicy(
  value: string | undefined,
  warn: (message: string) => void = console.warn,
): RegistrationPolicy {
  const trimmed = value?.trim() ?? "";
  if (trimmed === MULTI_ACCOUNT_MODE) return "unlimited";
  if (trimmed !== "" && !warned.has(trimmed)) {
    warned.add(trimmed);
    warn(
      `[opengroow] OPENGROOW_ACCOUNT_MODE="${trimmed}" is not recognised: sign-up stays locked to a single account. ` +
        `The only value that opens registrations is "${MULTI_ACCOUNT_MODE}" (set it on the Convex deployment).`,
    );
  }
  return "single-account";
}
