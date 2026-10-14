export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const connectUrl = url.searchParams.get("connectUrl")?.trim() ?? "";
  if (!connectUrl) {
    return Response.json(
      { status: 400, error: "connectUrl is required" },
      { status: 400 },
    );
  }

  let statusUrl: URL;
  try {
    const parsed = new URL(connectUrl);
    statusUrl = new URL(`${parsed.pathname.replace(/\/$/, "")}/status${parsed.search}`, parsed);

    // connectUrl's origin is OPENCLAW_CONNECT_PUBLIC_BASE_URL, chosen for the
    // browser/remote-helper vantage point (e.g. http://localhost:4700 in the
    // self-host compose stack). This fetch runs server-side, inside the
    // dashboard's own container — "localhost" there is the dashboard
    // container itself, not the openclaw-connect one, so it must resolve
    // the relay by its internal compose hostname instead. Same split as
    // CONVEX_SITE_URL vs CONVEX_URL for the browser-facing address (see auth-server.ts).
    const internalBaseUrl = process.env.OPENCLAW_CONNECT_INTERNAL_URL?.trim();
    if (internalBaseUrl) {
      const internalOrigin = new URL(internalBaseUrl);
      statusUrl.protocol = internalOrigin.protocol;
      statusUrl.host = internalOrigin.host;
    }
  } catch {
    return Response.json({ status: 400, error: "Invalid connectUrl" }, { status: 400 });
  }

  try {
    const upstream = await fetch(statusUrl, { cache: "no-store" });
    const body = await upstream.text();
    return new Response(body, {
      status: upstream.status,
      headers: {
        "content-type": upstream.headers.get("content-type") ?? "application/json",
        "cache-control": "no-store",
      },
    });
  } catch (error: unknown) {
    return Response.json(
      {
        status: 502,
        error:
          error instanceof Error
            ? error.message
            : "Failed to fetch connect ticket status",
      },
      { status: 502 },
    );
  }
}
