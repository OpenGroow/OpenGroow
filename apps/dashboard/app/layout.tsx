import "./globals.css";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { ConvexClientProvider } from "@/src/components/convex-provider";
import { getToken } from "@/src/lib/auth-server";
import { OptionalPluginsProvider } from "@/src/components/optional-plugins-provider";
import { getOptionalPlugins } from "@/src/lib/optional-plugins";
import { getPublicUrls } from "@/src/lib/public-urls";

// Public URLs are read from process.env per request (runtime, not build time),
// so no page under this layout may be prerendered at build.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "OpenClaw Dashboard",
  description: "Manage your OpenGroow Projects and their agents",
};

// ConvexClientProvider lives here (not in app/(app)/layout.tsx) so /sign-in
// and /sign-up — which must render without the auth-gate redirect below —
// still have a Convex client for their own (unauthenticated) queries.
// The auth gate itself lives in app/(app)/layout.tsx.
export default async function RootLayout({
  children,
}: {
  children: ReactNode;
}) {
  const initialToken = await getToken();
  const { convexUrl, appUrl } = getPublicUrls();

  return (
    <html lang="en" className="dark font-sans">
      <body>
        <ConvexClientProvider
          initialToken={initialToken}
          convexUrl={convexUrl}
          appUrl={appUrl}
        >
          <OptionalPluginsProvider plugins={getOptionalPlugins()}>
            {children}
          </OptionalPluginsProvider>
        </ConvexClientProvider>
      </body>
    </html>
  );
}
