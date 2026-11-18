import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import type { SourcePlatformDeclaration } from "@opengroow/agent-templates";
import { api } from "../_generated/api";
import schema from "../schema";
import { insertInstance } from "./instance_fixture";
import { fixtureTemplate, installTemplateRegistry } from "./helpers/template_registry.helpers";

const modules = {
  "../_generated/api.ts": () => import("../_generated/api.js"),
  "../instance_ownership.ts": () => import("../instance_ownership.js"),
  "../instances.ts": () => import("../instances.js"),
  "../source_platforms.ts": () => import("../source_platforms.js"),
  "../source_enrichment.ts": () => import("../source_enrichment.js"),
};

const INSTANCE = "platforms-instance";
const OWNER = { name: "Owner", email: "owner@example.com", tokenIdentifier: "test|platforms", subject: "owner-platforms" };
const ICON = "data:image/svg+xml;base64,PHN2Zy8+";
const declaration = (type: string, platform?: SourcePlatformDeclaration) => ({
  type, label: type, family: "social-video", agentsMd: `sources/${type}.md`, analysisSchema: { type: "object" as const }, ...(platform ? { platform } : {}),
});

let restoreRegistry: () => void;
beforeEach(() => {
  restoreRegistry = installTemplateRegistry([INSTANCE], [
    fixtureTemplate("social", {
      sources: [
        declaration("instagram-reel", { name: "Instagram", icon: ICON, pageHosts: ["instagram.com"], mediaLabels: { video: "Reel" } }),
        declaration("keyword"),
      ],
    }),
  ]);
});
afterEach(() => restoreRegistry());

async function seed(t: ReturnType<typeof convexTest>) {
  await t.run(async (ctx) => {
    await insertInstance(ctx, {
      jobId: "job-platforms", status: "running", runtimeStatus: "linked", runtimeReady: true,
      createdAt: new Date(0).toISOString(), openclawId: INSTANCE, updatedAt: new Date(0).toISOString(), userId: OWNER.subject,
    });
    await ctx.db.insert("projectAgents", { instanceId: INSTANCE, templateId: "social", status: "active", mcpServerKeys: [], createdAt: 0, updatedAt: 0 });
  });
}

describe("source platforms", () => {
  it("lists the platform each Source declares, with its icon and media words", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    const platforms = await t.withIdentity(OWNER).query(api.source_platforms.forInstance, { instanceId: INSTANCE });
    expect(platforms).toEqual([
      { templateId: "social", sourceId: "instagram-reel", name: "Instagram", icon: ICON, mediaLabels: { video: "Reel" } },
    ]);
  });

  it("lists nothing to someone who does not own the Instance", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    const other = { ...OWNER, tokenIdentifier: "test|other", subject: "someone-else" };
    expect(await t.withIdentity(other).query(api.source_platforms.forInstance, { instanceId: INSTANCE })).toEqual([]);
  });
});
