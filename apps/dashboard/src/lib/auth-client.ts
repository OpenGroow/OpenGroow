"use client";

import { createAuthClient } from "better-auth/react";
import { convexClient } from "@convex-dev/better-auth/client/plugins";

function build(baseURL: string) {
  return createAuthClient({ baseURL, plugins: [convexClient()] });
}

type AuthClient = ReturnType<typeof build>;

let current: { baseURL: string; client: AuthClient } | null = null;

// The app URL is a runtime value (read on the server per request, passed down
// by ConvexClientProvider), so the client is built lazily instead of at module
// load from an inlined constant.
export function initAuthClient(baseURL: string): AuthClient {
  if (!current || current.baseURL !== baseURL) {
    current = { baseURL, client: build(baseURL) };
  }
  return current.client;
}

export function getAuthClient(): AuthClient {
  if (!current) {
    throw new Error("Auth client used before ConvexClientProvider initialised it.");
  }
  return current.client;
}

// Wrappers resolve the client at call time to avoid SSR destructuring issues.
export function useSession() {
  return getAuthClient().useSession();
}

export const signIn = {
  email: (...args: Parameters<AuthClient["signIn"]["email"]>) =>
    getAuthClient().signIn.email(...args),
  social: (...args: Parameters<AuthClient["signIn"]["social"]>) =>
    getAuthClient().signIn.social(...args)
};
export const signUp = {
  email: (...args: Parameters<AuthClient["signUp"]["email"]>) =>
    getAuthClient().signUp.email(...args)
};
export const signOut = (...args: Parameters<AuthClient["signOut"]>) =>
  getAuthClient().signOut(...args);
