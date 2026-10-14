"use client";

import { ConvexReactClient } from "convex/react";
import { ConvexBetterAuthProvider } from "@convex-dev/better-auth/react";
import { initAuthClient } from "@/src/lib/auth-client";
import { useMemo, type ReactNode } from "react";

// URLs are runtime values resolved by the server (src/lib/public-urls.ts) and
// passed in as props; nothing is inlined from process.env at build time.
export function ConvexClientProvider({
  children,
  initialToken,
  convexUrl,
  appUrl
}: {
  children: ReactNode;
  initialToken?: string | null;
  convexUrl: string;
  appUrl: string;
}) {
  const authClient = initAuthClient(appUrl);
  const client = useMemo(() => new ConvexReactClient(convexUrl), [convexUrl]);

  return (
    <ConvexBetterAuthProvider
      client={client}
      authClient={authClient}
      initialToken={initialToken}
    >
      {children}
    </ConvexBetterAuthProvider>
  );
}
