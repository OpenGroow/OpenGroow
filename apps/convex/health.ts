import { query } from "./_generated/server.js";

export const health = query({
  args: {},
  handler: async () => {
    return { ok: true, service: "convex" as const };
  }
});
