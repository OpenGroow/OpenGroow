import { query } from "./_generated/server.js";
import { components } from "./_generated/api.js";
import { env } from "./env.js";
import { resolveRegistrationPolicy } from "./auth_registration_policy.js";

// Public, unauthenticated: the dashboard's sign-in page needs to know whether
// to default to the sign-up view (zero-friction first boot on a fresh
// self-hosted instance, ADR-029) before a session exists.
// `hasExistingAccount` reads the Better Auth component's `user` model
// directly (the same model auth.ts's registration-lock hook counts via
// `adapter.count`) rather than duplicating any state in this app's schema.
export const getPublicAuthConfig = query({
  args: {},
  handler: async (ctx) => {
    const existingUser = await ctx.runQuery(components.betterAuth.adapter.findOne, {
      model: "user",
    });
    return {
      registrationPolicy: resolveRegistrationPolicy(env.OPENGROOW_ACCOUNT_MODE),
      hasExistingAccount: existingUser !== null,
    };
  },
});
