import { describe, it, expect } from "vitest";
import { resolveExternalJobContract } from "./index.js";
import { seoFixtureTemplate } from "./__fixtures__/templates.js";

describe("ExternalJobHandoff schema (run_result in_progress branch)", () => {
  // The External Job handoff is a NON-TERMINAL shape distinct from terminal RunResult.
  // This is validated by the runResultSchema (status: "in_progress").

  it("seo template does NOT declare a top-level externalJob (uses the uniform externalJobsByMissionType map)", () => {
    const seo = seoFixtureTemplate();
    expect((seo.manifest as unknown as Record<string, unknown>).externalJob).toBeUndefined();
    expect(seo.manifest.externalJobsByMissionType).toBeDefined();
  });

  describe("resolveExternalJobContract — SEO create_article", () => {
    it("returns the generate_article contract from externalJobsByMissionType", () => {
      const seo = seoFixtureTemplate();
      const contract = resolveExternalJobContract(seo.manifest, "create_article", "generate_article");
      expect(contract).toBeDefined();
      expect(contract!.server).toBe("article-mcp");
      expect(contract!.mcpTool).toBe("get_article_status");
      expect(contract!.statusField).toBe("status");
      expect(contract!.resultIdField).toBe("articleId");
      expect(contract!.resultStatus).toBe("needs_human_review");
      expect(contract!.artifactKind).toBe("markdown");
      expect(contract!.terminalStates.completed).toContain("completed");
      expect(contract!.terminalStates.failed).toContain("failed");
    });

    it("create_article contract does not use jobId as artifact id (resultIdField is set)", () => {
      const seo = seoFixtureTemplate();
      const contract = resolveExternalJobContract(seo.manifest, "create_article", "generate_article");
      expect(contract!.resultIdField).toBeDefined();
    });

    it("returns undefined for a job type not declared for this mission type", () => {
      const seo = seoFixtureTemplate();
      const contract = resolveExternalJobContract(seo.manifest, "create_article", "not_a_real_job");
      expect(contract).toBeUndefined();
    });

    it("returns the plan_article contract as an Intermediate External Job (ADR-026, #245)", () => {
      const seo = seoFixtureTemplate();
      const contract = resolveExternalJobContract(seo.manifest, "create_article", "plan_article");
      expect(contract).toBeDefined();
      expect(contract!.server).toBe("article-mcp");
      expect(contract!.mcpTool).toBe("get_plan_status");
      expect(contract!.statusField).toBe("status");
      expect(contract!.onComplete).toBe("resume_mission");
      expect(contract!.terminalStates.completed).toEqual(["completed", "skipped"]);
      expect(contract!.terminalStates.failed).toEqual(["failed"]);
    });

    it("create_article declares both plan_article (intermediate) and generate_article (terminal) distinctly", () => {
      const seo = seoFixtureTemplate();
      const planContract = resolveExternalJobContract(seo.manifest, "create_article", "plan_article")!;
      const generateContract = resolveExternalJobContract(seo.manifest, "create_article", "generate_article")!;
      expect(planContract.onComplete).toBe("resume_mission");
      expect(generateContract.onComplete).toBe("terminal");
    });
  });

  it("a Mission type's External Job contract is independent of its review contract", () => {
    const manifest = {
      id: "t",
      name: "T",
      description: "d",
      category: "test",
      mcpServers: [{ name: "svc", transport: "streamable-http", url: "http://x/mcp" }],
      missionTypes: [
        {
          type: "make_video",
          label: "Make",
          payload: "{}",
          agentsMd: "make.md",
          review: { kind: "video", server: "svc", path: "/videos/{id}/final", actions: [{ key: "approve" }] },
        },
      ],
      externalJobsByMissionType: {
        make_video: {
          produce_video: {
            server: "svc",
            mcpTool: "get_run_status",
            statusField: "status",
            onComplete: "terminal",
            artifactKind: "video",
            terminalStates: { completed: ["completed"], failed: ["failed"] },
          },
        },
      },
    };
    const contract = resolveExternalJobContract(manifest as never, "make_video", "produce_video");
    expect(contract).toBeDefined();
    expect(manifest.missionTypes[0].review).toBeDefined();
    // The External Job contract is about POLLING during awaiting_job; the review
    // contract is about DISPLAYING the result and running approve/publish actions.
    expect(contract!.artifactKind).toBe(manifest.missionTypes[0].review.kind);
  });
});
