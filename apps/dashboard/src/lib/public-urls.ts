// Browser-facing URLs, read from the server's environment on every request
// (the root layout is dynamic) and handed to the client through
// ConvexClientProvider. Nothing here is inlined at build time, so one image
// serves any domain: change the env vars and restart the container.
//
// Deliberately NOT named NEXT_PUBLIC_*: Next inlines those into bundles.
// CONVEX_URL / CONVEX_SITE_URL stay the server-internal addresses used by
// auth-server.ts (inside Docker they differ from the browser-facing ones).

export type PublicUrls = {
  convexUrl: string;
  appUrl: string;
  seoMcpUrl: string;
};

function read(name: string): string {
  return process.env[name]?.trim() ?? "";
}

export function getPublicUrls(): PublicUrls {
  return {
    convexUrl: read("PUBLIC_CONVEX_URL") || "http://127.0.0.1:3210",
    appUrl: read("PUBLIC_APP_URL") || read("DASHBOARD_URL") || "http://localhost:3912",
    seoMcpUrl: read("PUBLIC_SEO_MCP_URL") || "http://127.0.0.1:3500"
  };
}
