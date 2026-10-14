import { httpRouter } from "convex/server";
import { authComponent, createAuth } from "./auth";
import { missionSummaryHandler } from "./mission_summary_http";

const http = httpRouter();
authComponent.registerRoutes(http, createAuth);

http.route({
  path: "/api/mission-summary",
  method: "POST",
  handler: missionSummaryHandler,
});

export default http;
