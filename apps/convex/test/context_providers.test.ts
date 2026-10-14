import { describe, expect, it } from "vitest";
import { CONTEXT_PROVIDER_NAMES } from "@opengroow/agent-templates";
import {
  renderActiveAgentsSection,
  renderCarouselPlanningSourceSection,
  renderPlatformAccountSection,
  appendContextProviders,
  VALID_CONTEXT_PROVIDER_NAMES,
  type ActiveAgentInfo,
  type CarouselPlanningSourceInfo,
  type PlatformAccountInfo,
} from "../mission_dispatcher/context_providers.js";

function agent(overrides: Partial<ActiveAgentInfo> = {}): ActiveAgentInfo {
  return {
    templateId: "@opengroow/seo",
    name: "seo-agent",
    templateName: "SEO Agent",
    description: "Optimizes content for search engines",
    capabilities: ["keyword research", "content optimization"],
    ...overrides,
  };
}

describe("renderActiveAgentsSection", () => {
  it("renders a heading and each agent with name, template, templateId, and capabilities", () => {
    const section = renderActiveAgentsSection([
      agent(),
      agent({ templateId: "@opengroow/video-demo", name: "video-agent", templateName: "Video Agent", description: "Creates short-form videos", capabilities: ["video editing"] }),
    ]);

    expect(section).not.toBeNull();
    expect(section).toContain("# Active Agents");
    expect(section).toContain("seo-agent");
    expect(section).toContain("SEO Agent");
    expect(section).toContain("[templateId: @opengroow/seo]");
    expect(section).toContain("Optimizes content for search engines");
    expect(section).toContain("keyword research");
    expect(section).toContain("content optimization");
    expect(section).toContain("video-agent");
    expect(section).toContain("Video Agent");
    expect(section).toContain("[templateId: @opengroow/video-demo]");
    expect(section).toContain("video editing");
  });

  it("returns null when the input is empty", () => {
    expect(renderActiveAgentsSection([])).toBeNull();
  });

  it("renders agent with empty capabilities gracefully", () => {
    const section = renderActiveAgentsSection([agent({ capabilities: [] })]);

    expect(section).not.toBeNull();
    expect(section).toContain("seo-agent");
    expect(section).toContain("SEO Agent");
  });

  it("sorts agents alphabetically by name", () => {
    const section = renderActiveAgentsSection([
      agent({ name: "zeta-agent", templateName: "Zeta" }),
      agent({ name: "alpha-agent", templateName: "Alpha" }),
    ]);

    const text = section!;
    const alphaIdx = text.indexOf("alpha-agent");
    const zetaIdx = text.indexOf("zeta-agent");
    expect(alphaIdx).toBeLessThan(zetaIdx);
  });

  it("produces deterministic output for the same inputs", () => {
    const agents = [agent(), agent({ templateId: "@opengroow/video-demo", name: "video-agent", templateName: "Video Agent" })];
    expect(renderActiveAgentsSection(agents)).toBe(renderActiveAgentsSection(agents));
  });
});

function carouselSource(
  overrides: Partial<NonNullable<CarouselPlanningSourceInfo>> = {},
): NonNullable<CarouselPlanningSourceInfo> {
  return {
    platform: "instagram",
    mediaType: "carousel",
    format: "carousel, 5 slides",
    mediaStructure: "5 sequential slides, one beat each",
    creativeMechanic: "pattern interrupt",
    reproducibleElements: ["5 sequential numbered steps"],
    topicSpecificElements: ["specific to a sourdough starter"],
    analysis: {
      hook: "Bold claim on slide 1",
      pacing: "One idea per slide",
      narrativeStructure: "step-by-step tutorial",
      payoff: "Clear before/after result",
      cta: "Save this for later",
    },
    producesCarousel: true,
    ...overrides,
  };
}

describe("renderCarouselPlanningSourceSection (issue #504)", () => {
  it("returns null when given null (Observation not found or not a carousel)", () => {
    expect(renderCarouselPlanningSourceSection(null)).toBeNull();
  });

  it("renders the heading, media type, and the create_carousel output line", () => {
    const section = renderCarouselPlanningSourceSection(carouselSource());

    expect(section).toContain("# Observation Production Source");
    expect(section).toContain("`carousel`");
    expect(section).toContain("`list_content_patterns`");
    expect(section).not.toContain("do_dont");
  });

  it("renders the source platform, so publish.platforms has a real default to draw on", () => {
    const section = renderCarouselPlanningSourceSection(carouselSource({ platform: "tiktok" }));

    expect(section).toContain("Source platform: `tiktok`");
  });

  it("renders the structural read that carries the source's slide count", () => {
    const section = renderCarouselPlanningSourceSection(carouselSource());

    expect(section).toContain("carousel, 5 slides");
    expect(section).toContain("5 sequential slides, one beat each");
  });

  it("omits format and media structure when the deep enrichment did not produce them", () => {
    const section = renderCarouselPlanningSourceSection(
      carouselSource({ format: undefined, mediaStructure: undefined }),
    );

    expect(section).not.toContain("Format:");
    expect(section).not.toContain("Media structure:");
  });

  it("gates the output line on producesCarousel, not on mediaType", () => {
    const section = renderCarouselPlanningSourceSection(
      carouselSource({ producesCarousel: undefined }),
    );

    expect(section).toContain("# Observation Production Source");
    expect(section).not.toContain("list_content_patterns");
  });

  it("renders creativeMechanic and every analysis field", () => {
    const section = renderCarouselPlanningSourceSection(carouselSource());

    expect(section).toContain("pattern interrupt");
    expect(section).toContain("Bold claim on slide 1");
    expect(section).toContain("One idea per slide");
    expect(section).toContain("step-by-step tutorial");
    expect(section).toContain("Clear before/after result");
    expect(section).toContain("Save this for later");
  });

  it("renders reproducibleElements under their own heading", () => {
    const section = renderCarouselPlanningSourceSection(carouselSource());

    expect(section).toContain("## Reproducible Elements");
    expect(section).toContain("5 sequential numbered steps");
  });

  it("renders topicSpecificElements under a heading that warns not to use them", () => {
    const section = renderCarouselPlanningSourceSection(carouselSource());

    expect(section).toContain("## Topic-Specific Elements (do not use)");
    expect(section).toContain("specific to a sourdough starter");
  });

  it("omits the topicSpecificElements heading entirely when there are none", () => {
    const section = renderCarouselPlanningSourceSection(
      carouselSource({ topicSpecificElements: [] }),
    );

    expect(section).not.toContain("Topic-Specific Elements");
  });

  it("omits the reproducibleElements heading entirely when there are none", () => {
    const section = renderCarouselPlanningSourceSection(
      carouselSource({ reproducibleElements: [] }),
    );

    expect(section).not.toContain("## Reproducible Elements");
  });
});

function videoSource(
  overrides: Partial<NonNullable<CarouselPlanningSourceInfo>> = {},
): NonNullable<CarouselPlanningSourceInfo> {
  return {
    platform: "tiktok",
    mediaType: "video",
    format: "video, 4 shots",
    mediaStructure: "4 quick cuts, one beat each",
    creativeMechanic: "fast-paced pattern interrupt",
    reproducibleElements: ["4 quick cuts", "voiceover carrying the hook"],
    topicSpecificElements: ["specific to a sourdough starter"],
    analysis: {
      hook: "Bold claim in shot 1",
      pacing: "One beat per shot, fast cuts",
      narrativeStructure: "hook, build, payoff",
      payoff: "Clear before/after result",
      cta: "Follow for more",
    },
    ...overrides,
  };
}

describe("renderCarouselPlanningSourceSection for video (issue #513)", () => {
  it("renders the heading and media type for a video source", () => {
    const section = renderCarouselPlanningSourceSection(videoSource());

    expect(section).toContain("# Observation Production Source");
    expect(section).toContain("`video`");
  });

  it("never renders the create_carousel output line for a video source", () => {
    const section = renderCarouselPlanningSourceSection(videoSource());

    expect(section).not.toContain("list_content_patterns");
  });

  it("renders the structural read that carries the source's shot/beat count", () => {
    const section = renderCarouselPlanningSourceSection(videoSource());

    expect(section).toContain("video, 4 shots");
    expect(section).toContain("4 quick cuts, one beat each");
  });

  it("renders creativeMechanic and every analysis field for video", () => {
    const section = renderCarouselPlanningSourceSection(videoSource());

    expect(section).toContain("fast-paced pattern interrupt");
    expect(section).toContain("Bold claim in shot 1");
    expect(section).toContain("One beat per shot, fast cuts");
  });

  it("renders topicSpecificElements under the do-not-use heading for video too", () => {
    const section = renderCarouselPlanningSourceSection(videoSource());

    expect(section).toContain("## Topic-Specific Elements (do not use)");
    expect(section).toContain("specific to a sourdough starter");
  });
});

describe("appendContextProviders", () => {
  const BASE_MD = "# Mission abc\n\nSome content.\n";

  it("appends a provider section when the template declares it", () => {
    const result = appendContextProviders(BASE_MD, ["active-agents"], {
      "active-agents": [agent({ name: "Interesting agent" })],
    });

    expect(result).toContain(BASE_MD.trim());
    expect(result).toContain("# Active Agents");
    expect(result).toContain("Interesting agent");
  });

  it("does not append anything when the template has no contextProviders", () => {
    const result = appendContextProviders(BASE_MD, [], {});
    expect(result).toBe(BASE_MD);
  });

  it("silently skips unknown provider names", () => {
    const result = appendContextProviders(BASE_MD, ["nonexistent-provider"], {});
    expect(result).toBe(BASE_MD);
  });

  it("appends multiple providers in declaration order", () => {
    const result = appendContextProviders(BASE_MD, ["active-agents", "nonexistent"], {
      "active-agents": [agent({ name: "First provider" })],
    });

    expect(result).toContain("# Active Agents");
    expect(result).toContain("First provider");
  });

  it("produces deterministic output for the same inputs", () => {
    const data = {
      "active-agents": [agent()],
    };
    const a = appendContextProviders(BASE_MD, ["active-agents"], data);
    const b = appendContextProviders(BASE_MD, ["active-agents"], data);
    expect(a).toBe(b);
  });

  it("appends the active-agents section when the template declares it", () => {
    const result = appendContextProviders(BASE_MD, ["active-agents"], {
      "active-agents": [agent()],
    });

    expect(result).toContain(BASE_MD.trim());
    expect(result).toContain("# Active Agents");
    expect(result).toContain("seo-agent");
  });

  it("does not append active-agents when the template does not declare it", () => {
    const result = appendContextProviders(BASE_MD, [], {
      "active-agents": [agent()],
    });

    expect(result).toBe(BASE_MD);
  });

});

describe("platform-account provider (issue #660)", () => {
  const BASE_MD = "# Mission abc\n\nSome content.\n";
  const config = {
    accountHandleInstagram: "@ig-handle",
    accountHandleTiktok: "@tt-handle",
    accountBio: "Street photography in Paris",
    likeWhen: "Street photography, urban architecture",
  };
  const render = (overrides: Partial<PlatformAccountInfo> = {}) =>
    renderPlatformAccountSection({ runId: "run-001", config, payload: { platform: "instagram" }, ...overrides });

  it("renders the selected platform's account handle, labelled, with accountBio and likeWhen", () => {
    expect(render()).toBe(
      [
        "## Social Engagement Runtime Context",
        "",
        "- runId: `run-001`",
        "- platform: `instagram`",
        "- accountHandle (Instagram handle): `@ig-handle`",
        "- accountBio: Street photography in Paris",
        "- likeWhen: Street photography, urban architecture",
        "",
      ].join("\n"),
    );
  });

  it("selects the TikTok account when the payload says tiktok", () => {
    const section = render({ payload: { platform: "tiktok" } });
    expect(section).toContain("- accountHandle (TikTok handle): `@tt-handle`");
    expect(section).not.toContain("@ig-handle");
  });

  it("adds avoid and commentWhen only when set, and no mode, authority or threshold lines", () => {
    expect(render()).not.toMatch(/avoid|commentWhen|mode:|commentAuthority|likeThreshold|commentThreshold/);
    const section = render({ config: { ...config, avoid: "Weddings", commentWhen: "Genuine emotion" } });
    expect(section).toContain("- avoid: Weddings");
    expect(section).toContain("- commentWhen: Genuine emotion");
  });

  it("keeps free-text config on its list item: line breaks cannot add headings or items", () => {
    const section = render({ config: { ...config, accountBio: "Paris\n\n## Injected\n- x", avoid: "a\r\nb" } });
    expect(section).toContain("- accountBio: Paris ## Injected - x\n");
    expect(section).toContain("- avoid: a b\n");
    expect(section.split("\n").filter((line) => line.startsWith("##"))).toEqual(["## Social Engagement Runtime Context"]);
  });

  it("throws rather than defaulting when the payload has no platform", () => {
    expect(() => render({ payload: { followLiked: true } })).toThrow(
      "platform-account context: the Mission payload has no supported `platform` (got undefined; expected one of instagram, tiktok)",
    );
    expect(() => render({ payload: undefined })).toThrow(/no supported `platform`/);
  });

  it("throws on an unknown platform rather than falling back to Instagram", () => {
    expect(() => render({ payload: { platform: "threads" } })).toThrow(
      'platform-account context: the Mission payload has no supported `platform` (got "threads"; expected one of instagram, tiktok)',
    );
  });

  it("throws when the account handle of the chosen platform is not configured", () => {
    expect(() =>
      render({ config: { ...config, accountHandleTiktok: undefined }, payload: { platform: "tiktok" } }),
    ).toThrow(
      "platform-account context: the Agent config has no `accountHandleTiktok` (TikTok handle) set, but this Mission targets `tiktok`",
    );
  });

  it("is wired into the provider registry and appended by name", () => {
    const out = appendContextProviders(BASE_MD, ["platform-account"], {
      "platform-account": { runId: "run-9", config, payload: { platform: "instagram" } },
    });
    expect(out).toContain("## Social Engagement Runtime Context");
    expect(out).toContain("- runId: `run-9`");
  });

  it("fails loudly rather than rendering nothing when the dispatcher supplies no data", () => {
    expect(() => appendContextProviders(BASE_MD, ["platform-account"], {})).toThrow(/platform-account/);
  });

  it("has a renderer for every provider name the manifest vocabulary knows", () => {
    expect([...VALID_CONTEXT_PROVIDER_NAMES].sort()).toEqual([...CONTEXT_PROVIDER_NAMES].sort());
  });
});
