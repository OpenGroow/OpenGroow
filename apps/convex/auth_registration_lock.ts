// Self-host registration lock (issue #263 / ADR-029): a self-hosted
// deployment is single-tenant — the first successful sign-up becomes the
// sole admin, and every subsequent sign-up is rejected. Pure decision
// function so it's unit-testable without driving a real auth flow; wired
// into Better Auth's `databaseHooks.user.create.before` in auth.ts.
export function shouldAllowSignUp(existingUserCount: number): boolean {
  return existingUserCount <= 0;
}

export const REGISTRATION_LOCKED_MESSAGE =
  "Registration is closed: this self-hosted instance already has an account. Only one account is supported.";
