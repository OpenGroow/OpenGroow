import { createClient } from "@convex-dev/better-auth";
import { components } from "./_generated/api";
import { betterAuth } from "better-auth/minimal";
import { APIError } from "better-auth/api";
import { convex } from "@convex-dev/better-auth/plugins";
import authConfig from "./auth.config";
import type { GenericCtx } from "@convex-dev/better-auth";
import { env } from "./env";
import { shouldAllowSignUp, REGISTRATION_LOCKED_MESSAGE } from "./auth_registration_lock";
import { resolveRegistrationPolicy } from "./auth_registration_policy";

export const authComponent = createClient(components.betterAuth);

export function createAuth(ctx: GenericCtx) {
  const registrationPolicy = resolveRegistrationPolicy(env.OPENGROOW_ACCOUNT_MODE);

  return betterAuth({
    // The dashboard is the only app: it is the auth origin.
    baseURL: env.DASHBOARD_URL,
    trustedOrigins: [env.DASHBOARD_URL],
    database: authComponent.adapter(ctx),
    // Self-host (ADR-029): email/password with no verification step, so a
    // self-hoster can create an account with zero external dependencies
    // (no SMTP/Resend). Registration then locks via the databaseHooks
    // below.
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: false,
    },
    // Single-account by default (ADR-059): only an explicit
    // OPENGROOW_ACCOUNT_MODE=multi-account skips this check.
    ...(registrationPolicy === "single-account"
      ? {
          databaseHooks: {
            user: {
              create: {
                async before(_user: unknown, hookCtx: { context: { adapter: { count(args: { model: string }): Promise<number> } } } | null) {
                  if (!hookCtx) return;
                  const existingUserCount = await hookCtx.context.adapter.count({ model: "user" });
                  if (!shouldAllowSignUp(existingUserCount)) {
                    throw new APIError("BAD_REQUEST", { message: REGISTRATION_LOCKED_MESSAGE });
                  }
                },
              },
            },
          },
        }
      : {}),
    // Convex HTTP actions run behind an internal proxy that does not forward
    // client IPs. Better Auth's IP-based rate limiting is not meaningful here
    // (Convex enforces its own rate limits). Disable to suppress the warning.
    rateLimit: {
      enabled: false,
    },
    plugins: [convex({ authConfig })]
  });
}
