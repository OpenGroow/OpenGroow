import { httpRouter } from "convex/server";
import { authComponent, createAuth } from "./auth";
import { missionSummaryHandler } from "./mission_summary_http";
import { internalMcpHandler, internalMcpNotAllowed } from "./internal_mcp/http";

const http = httpRouter();
authComponent.registerRoutes(http, createAuth);

http.route({
  path: "/api/mission-summary",
  method: "POST",
  handler: missionSummaryHandler,
});

// The Internal MCP (ADR-080): stateless, so only POST is served.
http.route({ path: "/internal-mcp", method: "POST", handler: internalMcpHandler });
http.route({ path: "/internal-mcp", method: "GET", handler: internalMcpNotAllowed });
http.route({ path: "/internal-mcp", method: "DELETE", handler: internalMcpNotAllowed });

export default http;
