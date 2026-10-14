import { describe, expect, it } from "vitest";
import {
  buildMissionContext,
  renderBrandCoreSection,
} from "../mission_dispatcher/mission_context.js";
import type { Id } from "../_generated/dataModel";

const MISSION_ID = "mission-abc" as Id<"missions">;
const RUN_ID = "run-xyz" as Id<"runs">;

const mission = {
  _id: MISSION_ID,
  templateId: "@opengroow/seo",
  type: "create_article",
  payload: { topic: "Octopus husbandry", tone: "playful" },
} as const;

const run = {
  _id: RUN_ID,
  missionId: MISSION_ID,
  agentName: "seo",
} as const;

describe("renderBrandCoreSection", () => {
  it("renders each filled rubric with its heading and the self-describing instruction", () => {
    const section = renderBrandCoreSection({
      audience: "Independent shop owners",
      tone: "Clear and direct",
      offer: "Done-for-you workflows",
      positioning: "Practical automation partner",
      editorialRules: "Use concrete examples",
      constraints: "No unverifiable claims",
      avoid: "Empty hype",
      notes: "Seasonal campaigns matter",
    });

    expect(section).not.toBeNull();
    expect(section).toContain("Apply this brand guidance to everything you produce in this mission.");
    expect(section).toContain("## Audience\n\nIndependent shop owners");
    expect(section).toContain("## Tone of Voice\n\nClear and direct");
    expect(section).toContain("## Offer\n\nDone-for-you workflows");
    expect(section).toContain("## Positioning\n\nPractical automation partner");
    expect(section).toContain("## Editorial Rules\n\nUse concrete examples");
    expect(section).toContain("## Constraints\n\nNo unverifiable claims");
    expect(section).toContain("## Things to Avoid\n\nEmpty hype");
    expect(section).toContain("## Additional Notes\n\nSeasonal campaigns matter");
  });

  it("omits empty rubrics and returns no section when every rubric is empty", () => {
    expect(
      renderBrandCoreSection({
        audience: "  Small business founders  ",
        tone: "",
        offer: "   ",
      }),
    ).toContain("## Audience\n\nSmall business founders");
    expect(
      renderBrandCoreSection({
        audience: "  Small business founders  ",
        tone: "",
        offer: "   ",
      }),
    ).not.toContain("## Tone of Voice");

    expect(
      renderBrandCoreSection({
        audience: "",
        tone: " ",
        offer: "",
        positioning: "",
        editorialRules: "",
        constraints: "",
        avoid: "",
        notes: "",
      }),
    ).toBeNull();
  });
});

describe("buildMissionContext", () => {
  it("renders a context.md with the mission type and payload", () => {
    const { contextMd } = buildMissionContext(mission, run);
    expect(contextMd).toContain("create_article");
    expect(contextMd).toContain("Octopus husbandry");
    expect(contextMd).toContain("playful");
  });

  it("prepends Brand Core guidance before the mission section when provided", () => {
    const { contextMd } = buildMissionContext(
      {
        ...mission,
        brandCore: {
          audience: "Independent shop owners",
          tone: "Clear and direct",
        },
      },
      run,
    );

    expect(contextMd).toMatch(/^# Brand Core\n/);
    expect(contextMd).toContain("Apply this brand guidance to everything you produce in this mission.");
    expect(contextMd).toContain("## Audience\n\nIndependent shop owners");
    expect(contextMd).toContain("## Tone of Voice\n\nClear and direct");
    expect(contextMd.indexOf("# Brand Core")).toBeLessThan(contextMd.indexOf(`# Mission ${MISSION_ID}`));
  });

  it("omits the Brand Core section when no rubrics are filled", () => {
    const { contextMd } = buildMissionContext(
      {
        ...mission,
        brandCore: {
          audience: "",
          tone: " ",
        },
      },
      run,
    );

    expect(contextMd).toMatch(new RegExp(`^# Mission ${MISSION_ID}\\n`));
    expect(contextMd).not.toContain("# Brand Core");
    expect(contextMd).toContain("## Payload");
  });

  it("renders the previous RunResult in context.md when present", () => {
    const { contextMd } = buildMissionContext(
      {
        ...mission,
        lastResult: {
          status: "needs_human_review",
          artifact: { metadata: { articleId: "article-123" } },
        },
      },
      run,
    );

    expect(contextMd).toContain("## Last Result");
    expect(contextMd).toContain("article-123");
  });

  it("renders the last Intermediate Result in context.md when present (ADR-026)", () => {
    const { contextMd } = buildMissionContext(
      {
        ...mission,
        lastIntermediateResult: {
          jobType: "plan_article",
          output: { articlePlan: { steps: ["outline", "draft"] } },
        },
      },
      run,
    );

    expect(contextMd).toContain("## Last Intermediate Result");
    expect(contextMd).toContain("plan_article");
    expect(contextMd).toContain("articlePlan");
  });

  it("omits the Last Intermediate Result section when absent", () => {
    const { contextMd } = buildMissionContext(mission, run);
    expect(contextMd).not.toContain("## Last Intermediate Result");
  });

  describe("Previous Attempt Failed (retryable External Job failure, ADR-026 extension)", () => {
    it("renders the error and remaining attempts under MAX_RETRYABLE_JOB_FAILURES", () => {
      const { contextMd } = buildMissionContext(
        {
          ...mission,
          lastRetryableFailure: {
            jobType: "produce_video",
            error: "Letter service failed: 400 Bad Request — title too long",
            details: { failedStep: "generateLetter" },
          },
          retryableFailureCount: 1,
        },
        run,
      );

      expect(contextMd).toContain("## Previous Attempt Failed");
      expect(contextMd).toContain("produce_video");
      expect(contextMd).toContain("Letter service failed: 400 Bad Request — title too long");
      expect(contextMd).toContain("Fix the issue in your Manifest before retrying");
      expect(contextMd).toContain("You have 2 attempts left after this one");
      expect(contextMd).toContain("failedStep");
    });

    it("uses singular 'attempt' when exactly one is left", () => {
      const { contextMd } = buildMissionContext(
        {
          ...mission,
          lastRetryableFailure: { error: "boom" },
          retryableFailureCount: 2,
        },
        run,
      );
      expect(contextMd).toContain("You have 1 attempt left after this one");
    });

    it("warns this was the last attempt when retryableFailureCount reaches MAX_RETRYABLE_JOB_FAILURES", () => {
      const { contextMd } = buildMissionContext(
        {
          ...mission,
          lastRetryableFailure: { error: "boom" },
          retryableFailureCount: 3,
        },
        run,
      );
      expect(contextMd).toContain("This was your last attempt");
      expect(contextMd).not.toContain("attempts left");
    });

    it("defaults to treating it as the first attempt when retryableFailureCount is omitted", () => {
      const { contextMd } = buildMissionContext(
        {
          ...mission,
          lastRetryableFailure: { error: "boom" },
        },
        run,
      );
      expect(contextMd).toContain("You have 2 attempts left after this one");
    });

    it("omits the section entirely when there is no lastRetryableFailure", () => {
      const { contextMd } = buildMissionContext(mission, run);
      expect(contextMd).not.toContain("## Previous Attempt Failed");
    });

    it("uses a generic (non-Manifest) instruction when the retryable failure has no jobType, as for an invalid RunResult", () => {
      const { contextMd } = buildMissionContext(
        {
          ...mission,
          lastRetryableFailure: {
            error: "Output file doesn't match the expected format: missing summary",
          },
          retryableFailureCount: 1,
        },
        run,
      );
      expect(contextMd).toContain(
        "Fix the issue before retrying — write outputs.json that matches the required RunResult schema.",
      );
      expect(contextMd).not.toContain("in your Manifest");
    });
  });

  it("renders a runs/<runId>.md trigger pointer that references the context and outputs paths", () => {
    const { runMd } = buildMissionContext(mission, run);
    expect(runMd).toContain(`missions/${MISSION_ID}/context.md`);
    expect(runMd).toContain(`missions/${MISSION_ID}/outputs/${RUN_ID}.json`);
  });

  it("returns deterministic output for the same inputs", () => {
    const a = buildMissionContext(mission, run);
    const b = buildMissionContext(mission, run);
    expect(a).toEqual(b);
  });

  it("includes ## Human Feedback section in runMd when humanFeedback is provided", () => {
    const feedback = "The tone is too formal, please make it friendlier.";
    const { runMd } = buildMissionContext(mission, { ...run, humanFeedback: feedback });
    expect(runMd).toContain("## Human Feedback");
    expect(runMd).toContain(feedback);
  });

  it("omits ## Human Feedback section when humanFeedback is absent", () => {
    const { runMd } = buildMissionContext(mission, run);
    expect(runMd).not.toContain("## Human Feedback");
  });

  it("includes a generic revision-run instruction alongside the Human Feedback section", () => {
    const feedback = "The tone is too formal, please make it friendlier.";
    const { runMd } = buildMissionContext(mission, { ...run, humanFeedback: feedback });
    expect(runMd).toContain("revision run");
    expect(runMd).toContain(
      "Do not resume or reuse a previous job, asset, or artifact id",
    );
  });

  it("omits the revision-run instruction when humanFeedback is absent", () => {
    const { runMd } = buildMissionContext(mission, run);
    expect(runMd).not.toContain("revision run");
  });
});
