import { convexBetterAuthNextJs } from "@convex-dev/better-auth/nextjs";

type AuthServer = ReturnType<typeof convexBetterAuthNextJs>;

let cachedAuthServer: AuthServer | null | undefined;

function getAuthServer(): AuthServer | null {
  if (cachedAuthServer !== undefined) {
    return cachedAuthServer;
  }

  const convexUrl = process.env.CONVEX_URL?.trim() ?? "";
  // Server-only, read at runtime: inside the self-host compose stack this is
  // the internal convex-backend hostname (auth.handler proxies to
  // `${siteUrl}/api/auth/...` from the dashboard container), while the
  // browser only ever talks to the dashboard's own /api/auth route.
  const convexSiteUrl = process.env.CONVEX_SITE_URL?.trim() ?? "";

  if (!convexUrl || !convexSiteUrl) {
    cachedAuthServer = null;
    return cachedAuthServer;
  }

  cachedAuthServer = convexBetterAuthNextJs({
    convexUrl,
    convexSiteUrl
  });
  return cachedAuthServer;
}

function missingAuthEnvResponse() {
  return Response.json(
    {
      error:
        "Missing Convex auth environment. Set CONVEX_URL and CONVEX_SITE_URL."
    },
    { status: 500 }
  );
}

// Same proxy as @convex-dev/better-auth's `nextJsHandler`, but the body is
// buffered first. The library re-wraps the incoming `Request` and streams it
// to `fetch`, which undici on Node 24 (host `pnpm dev`) rejects with
// "expected non-null body source" — the Docker images run Node 22 and are fine.
async function proxyToConvexSite(request: Request): Promise<Response> {
  const convexSiteUrl =
    process.env.CONVEX_SITE_URL?.trim() ?? "";
  const requestUrl = new URL(request.url);
  const siteUrl = new URL(convexSiteUrl);
  const proto = requestUrl.protocol.replace(/:$/, "");

  const headers = new Headers(request.headers);
  headers.set("accept-encoding", "application/json");
  headers.set("host", siteUrl.host);
  headers.set("x-forwarded-host", requestUrl.host);
  headers.set("x-forwarded-proto", proto);
  headers.set("x-better-auth-forwarded-host", requestUrl.host);
  headers.set("x-better-auth-forwarded-proto", proto);
  headers.delete("content-length");

  const hasBody = request.method !== "GET" && request.method !== "HEAD";
  return fetch(`${convexSiteUrl}${requestUrl.pathname}${requestUrl.search}`, {
    method: request.method,
    headers,
    body: hasBody ? await request.arrayBuffer() : undefined,
    redirect: "manual"
  });
}

export const handler = {
  GET(request: Request) {
    if (!getAuthServer()) {
      return missingAuthEnvResponse();
    }
    return proxyToConvexSite(request);
  },
  POST(request: Request) {
    if (!getAuthServer()) {
      return missingAuthEnvResponse();
    }
    return proxyToConvexSite(request);
  }
};

export async function isAuthenticated() {
  const auth = getAuthServer();
  if (!auth) {
    return false;
  }
  return auth.isAuthenticated();
}

export async function getToken() {
  const auth = getAuthServer();
  if (!auth) {
    return null;
  }
  return auth.getToken();
}
