/** @vitest-environment jsdom */

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MissionReviewContent } from "../src/components/mission-review-page";
import { INSTALLED_PUBLISHERS, PUBLISHER_PACKAGES_LIST } from "./postiz-installed";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

if (typeof window !== "undefined") {
  window.HTMLFormElement.prototype.requestSubmit = function requestSubmit() {};
}

const useQueryMock = vi.fn();
const useActionMock = vi.fn();
const useMutationMock = vi.fn();
const routerPushMock = vi.fn();
const getReviewMock = vi.fn();
const loadReviewContentMock = vi.fn();
const loadArticleMarkdownMock = vi.fn();
const performReviewActionMock = vi.fn();

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerPushMock }),
}));

// `publishers.list`: a test's single Publisher (or null for none) is the Project's only one (ADR-075).
const asPublisherList = (value: unknown) => (value === undefined ? undefined : value === null ? [] : Array.isArray(value) ? value : [value]);
vi.mock("convex/react", () => ({
  useQuery: (...args: unknown[]) =>
    args[0] === PUBLISHER_PACKAGES_LIST ? INSTALLED_PUBLISHERS : args[0] === "publishers.list" ? asPublisherList(useQueryMock(...args)) : useQueryMock(...args),
  useAction: (...args: unknown[]) => useActionMock(...args),
  useMutation: (...args: unknown[]) => useMutationMock(...args),
}));

vi.mock("@convex/_generated/api", () => ({
  api: {
    missions: { get: "missions.get" },
    missions_node: {
      getReview: "missions_node.getReview",
      performReviewAction: "missions_node.performReviewAction",
      loadReviewContent: "missions_node.loadReviewContent",
      loadArticleMarkdown: "missions_node.loadArticleMarkdown",
    },
    publisher_node: { retryPublication: "publisher_node.retryPublication" },
    publication_notify_node: { resendPublishedNotification: "publication_notify_node.resendPublishedNotification" },
    publishers: { list: "publishers.list" },
    publisher_packages: { list: "publisher_packages.list" },
    publications: {
      setPublishAt: "publications.setPublishAt",
      setTargets: "publications.setTargets",
      listForMission: "publications.listForMission",
    },
    instances: { list: "instances.list" },
    project_agents: { get: "project_agents.get" },
    runtime_commands_node: {
      requestWorkspaceFileRead: "runtime_commands_node.requestWorkspaceFileRead",
      getRuntimeCommandResult: "runtime_commands_node.getRuntimeCommandResult",
    },
  },
}));

vi.mock("@/src/lib/auth-client", () => ({
  useSession: () => ({ data: null }),
}));

vi.mock("@/src/components/workspace-markdown", () => ({
  WorkspaceMarkdown: ({ content }: { content: string }) => (
    <div data-testid="markdown">{content}</div>
  ),
}));

// Migrated artifact shape: external.id is the canonical identifier post-#146 migration.
const MISSION_WITH_ARTIFACT = {
  _id: "mission-1",
  instanceId: "instance-1",
  type: "create_article",
  status: "to_validate",
  templateId: "@opengroow/seo",
  createdAt: Date.now(),
  lastResult: {
    status: "needs_human_review",
    summary: "Article ready for review",
    reviewQuestions: ["Does the article match the keyword?"],
    artifact: {
      kind: "markdown",
      external: { service: "article-mcp", id: "art-123" },
      metadata: { keyword: "SEO tips", score: 87 },
    },
  },
};

// jsdom has no PointerEvent, which the Checkbox primitive dispatches on click.
globalThis.PointerEvent ??= MouseEvent as typeof PointerEvent;

// The channel checkboxes are the Checkbox primitive: its state is in ARIA/data attributes, not in .checked/.disabled.
const openChannelList = async () => {
  await act(async () => {
    (document.querySelector('[aria-label="Show channels"]') as HTMLElement).click();
  });
};
const channelItem = (target: string) => document.querySelector(`[data-testid="publish-target-${target}"]`) as HTMLElement | null;
const channelChip = (target: string) => document.querySelector(`[data-testid="publish-chip-${target}"]`) as HTMLElement | null;
const removeChip = async (target: string) => {
  await act(async () => {
    (channelChip(target)!.querySelector('[data-slot="combobox-chip-remove"]') as HTMLElement).click();
  });
};
const isDisabled = (el: Element) => el.hasAttribute("data-disabled") || el.getAttribute("aria-disabled") === "true";

describe("MissionReviewContent", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    useQueryMock.mockReset();
    useActionMock.mockReset();
    useMutationMock.mockReset();
    routerPushMock.mockReset();
    getReviewMock.mockReset();
    loadReviewContentMock.mockReset();
    loadArticleMarkdownMock.mockReset();
    performReviewActionMock.mockReset();

    useActionMock.mockImplementation((action: string) => {
      if (action === "missions_node.getReview") {
        return getReviewMock;
      }
      if (action === "missions_node.loadReviewContent") {
        return loadReviewContentMock;
      }
      if (action === "missions_node.performReviewAction") {
        return performReviewActionMock;
      }
      if (action === "missions_node.loadArticleMarkdown") {
        return loadArticleMarkdownMock;
      }
      return vi.fn();
    });
    useMutationMock.mockImplementation(() => vi.fn().mockResolvedValue({ runId: "run-1" }));
    getReviewMock.mockImplementation(async () => {
      const mission = useQueryMock("missions.get") as typeof MISSION_WITH_ARTIFACT;
      const artifact = mission?.lastResult?.artifact;
      const kind = artifact?.kind as "markdown" | "metadata" | "image" | "video" | undefined;
      const source = artifact?.external?.service === "workspace" ? "workspace" : "external";
      const isSocial = kind === "metadata" && source === "workspace";
      const actions = isSocial || !artifact
        ? []
        : [
            {
              key: "approve",
              label: kind === "image" ? "Approve and publish" : kind === "video" || mission.type === "internal_linking" ? "Validate" : "Approve",
              requiredStatus: "to_validate",
              inputs: [],
              enabled: mission.status === "to_validate",
            },
            ...(kind === "image"
              ? []
              : [{
                  key: "publish",
                  label: mission.type === "internal_linking" ? "Merge" : "Publish",
                  requiredStatus: "approved",
                  inputs: kind === "video" || (mission.templateId === "@opengroow/seo" && mission.type === "create_article")
                    ? [{ key: "publishDate", label: "Publish date", type: "datetime-local" as const, required: false }]
                    : [],
                  enabled: mission.status === "approved",
                }]),
            {
              key: "reject",
              label: kind === "image" || kind === "video" ? "Reject with feedback" : "Reject",
              requiredStatus: "to_validate",
              inputs: [{ key: "feedback", label: "Review Feedback", type: "text" as const, required: true }],
              enabled: mission.status === "to_validate",
            },
          ];
      return {
        status: mission.status,
        reviewable: mission.status === "to_validate" || mission.status === "approved",
        artifact: {
          available: Boolean(artifact),
          kind,
          externalId: artifact?.external?.id,
          metadata: artifact?.metadata ?? {},
        },
        content: artifact ? { kind: kind ?? "metadata", source, available: true } : null,
        actions,
        errors: artifact ? [] : ["No artifact available for this mission"],
      };
    });

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
    document.body.innerHTML = "";
  });

  function setupDefaultQuery() {
    useQueryMock.mockImplementation((key: string) => {
      if (key === "missions.get") return MISSION_WITH_ARTIFACT;
      return undefined;
    });
  }

  async function render() {
    await act(async () => {
      root.render(<MissionReviewContent instanceId="instance-1" missionId="mission-1" />);
    });
  }


  describe("Publishable preview (ADR-069)", () => {
    function missionWithPublishable(publishable: Record<string, unknown>) {
      return {
        ...MISSION_WITH_ARTIFACT,
        lastResult: {
          ...MISSION_WITH_ARTIFACT.lastResult,
          artifact: { ...MISSION_WITH_ARTIFACT.lastResult.artifact, publishable },
        },
        lastArtifact: { external: { service: "media", id: "42" }, publishable },
      };
    }

    async function renderWith(publishable: Record<string, unknown>) {
      useQueryMock.mockImplementation((key: string) =>
        key === "missions.get" ? missionWithPublishable(publishable) : undefined,
      );
      loadReviewContentMock.mockReturnValue(new Promise(() => {}));
      await render();
      await act(async () => {});
    }

    it("previews a video from its URL, with cover and caption", async () => {
      await renderWith({
        kind: "video",
        videoUrl: "https://cdn.example.com/v.mp4",
        coverUrl: "https://cdn.example.com/c.png",
        caption: "Watch this",
      });
      const preview = document.querySelector('[data-testid="publishable-preview"]');
      expect(preview?.textContent).toContain("Watch this");
      const video = preview?.querySelector("video") as HTMLVideoElement | null;
      expect(video?.src).toBe("https://cdn.example.com/v.mp4");
      expect(video?.poster).toBe("https://cdn.example.com/c.png");
    });

    it("previews an image from its URL", async () => {
      await renderWith({ kind: "image", imageUrl: "https://cdn.example.com/i.png", caption: "Pic" });
      const img = document.querySelector('[data-testid="publishable-preview"] img') as HTMLImageElement | null;
      expect(img?.src).toBe("https://cdn.example.com/i.png");
    });

    it("previews every slide of a carousel in order", async () => {
      await renderWith({
        kind: "carousel",
        slideUrls: ["https://cdn.example.com/1.png", "https://cdn.example.com/2.png"],
        caption: "Swipe",
      });
      const imgs = [...document.querySelectorAll('[data-testid="publishable-preview"] img')] as HTMLImageElement[];
      expect(imgs.map((img) => img.src)).toEqual([
        "https://cdn.example.com/1.png",
        "https://cdn.example.com/2.png",
      ]);
    });

    it("previews each variant of a carousel with its own images and text", async () => {
      await renderWith({
        kind: "carousel",
        caption: "Default",
        variants: {
          instagram: { slideUrls: ["https://cdn.example.com/ig-1.png"], caption: "For Instagram" },
          pinterest: { slideUrls: ["https://cdn.example.com/pin-1.png"], title: "Pin title", caption: "For Pinterest" },
        },
      });
      const pinterest = document.querySelector('[data-testid="publishable-variant-pinterest"]');
      expect(pinterest?.textContent).toContain("Pin title");
      expect(pinterest?.textContent).toContain("For Pinterest");
      expect((pinterest?.querySelector("img") as HTMLImageElement).src).toBe("https://cdn.example.com/pin-1.png");
      expect(document.querySelector('[data-testid="publishable-variant-instagram"] img')).not.toBeNull();
      expect(document.body.textContent).not.toContain("No previewable media");
    });

    describe("article (ADR-074)", () => {
      const ARTICLE = {
        kind: "article",
        markdownUrl: "https://seo.example.com/articles/a1.md",
        coverUrl: "https://seo.example.com/articles/a1/cover.webp",
        slug: "how-to-grow",
        title: "How to grow",
        description: "A short guide",
        category: "guides",
      };
      it("renders the article from its Publishable: cover, title, description and the markdown Convex reads from markdownUrl", async () => {
        loadArticleMarkdownMock.mockResolvedValue({ content: "## First step\n\nDig a hole." });
        await renderWith(ARTICLE);
        await act(async () => {});
        const preview = document.querySelector('[data-testid="publishable-preview"]');
        expect(loadArticleMarkdownMock).toHaveBeenCalledWith({ missionId: "mission-1" });
        expect((preview?.querySelector("img") as HTMLImageElement | null)?.src).toBe(ARTICLE.coverUrl);
        expect(preview?.textContent).toContain("How to grow");
        expect(preview?.textContent).toContain("A short guide");
        expect(preview?.textContent).toContain("how-to-grow");
        expect(preview?.textContent).toContain("First step");
        expect(preview?.textContent).toContain("Dig a hole.");
      });

      it("says when the markdown cannot be read, with a link to it", async () => {
        loadArticleMarkdownMock.mockRejectedValue(new Error("The article markdown could not be read: HTTP 404"));
        await renderWith(ARTICLE);
        await act(async () => {});
        const failure = document.querySelector('[data-testid="publishable-article-error"]');
        expect(failure?.textContent).toContain("could not be loaded");
        expect(failure?.querySelector("a")?.getAttribute("href")).toBe(ARTICLE.markdownUrl);
      });
    });

    it("reviews a Mission type that declares publish from its publishable only: no review.path content is loaded or shown", async () => {
      const base = getReviewMock.getMockImplementation()!;
      getReviewMock.mockImplementation(async () => ({
        ...(await base()),
        content: null,
        publish: { targets: [], mapped: true, unmappedTargets: [], publisherReady: true, publications: [] },
      }));
      await renderWith({ kind: "video", videoUrl: "https://cdn.example.com/v.mp4", caption: "Watch this" });
      expect(document.querySelector('[data-testid="publishable-preview"] video')).not.toBeNull();
      expect(loadReviewContentMock).not.toHaveBeenCalled();
      expect(document.body.textContent).not.toContain("Loading article");
      expect(document.body.textContent).not.toContain("SEO Metadata");
    });

    it("lets a publish-driven image Mission be validated: the review.path content it never loads does not block the action", async () => {
      const publishable = { kind: "carousel", caption: "Swipe", variants: { instagram: { slideUrls: ["https://cdn.example.com/ig-1.png"] } } };
      const mission = missionWithPublishable(publishable);
      useQueryMock.mockImplementation((key: string) =>
        key === "missions.get"
          ? { ...mission, status: "to_validate", lastResult: { ...mission.lastResult, artifact: { ...mission.lastResult.artifact, kind: "image" } } }
          : undefined,
      );
      const base = getReviewMock.getMockImplementation()!;
      getReviewMock.mockImplementation(async () => ({
        ...(await base()),
        content: null,
        publish: { targets: [], mapped: true, unmappedTargets: [], publisherReady: true, publications: [] },
      }));
      loadReviewContentMock.mockReturnValue(new Promise(() => {}));
      await render();
      await act(async () => {});
      expect(loadReviewContentMock).not.toHaveBeenCalled();
      expect((document.querySelector('[data-testid="review-action-approve"]') as HTMLButtonElement).disabled).toBe(false);
      expect(document.querySelector('[data-testid="review-action-blocked"]')).toBeNull();
    });

    it("shows a blocked Publish greyed with its reason, instead of hiding it", async () => {
      const mission = missionWithPublishable({ kind: "image", caption: "c", variants: { instagram: { imageUrl: "https://cdn.example.com/ig.png" } } });
      useQueryMock.mockImplementation((key: string) => (key === "missions.get" ? { ...mission, status: "approved" } : undefined));
      const base = getReviewMock.getMockImplementation()!;
      getReviewMock.mockImplementation(async () => {
        const review = await base();
        return {
          ...review,
          content: null,
          publish: { targets: ["pinterest:pins"], mapped: true, unmappedTargets: [], publisherReady: true, publications: [] },
          actions: review.actions.map((action: { key: string }) =>
            action.key === "publish"
              ? { ...action, enabled: false, disabledReason: 'Channel "pinterest:pins": this image was made for instagram only, it has no media for pinterest' }
              : action,
          ),
        };
      });
      loadReviewContentMock.mockReturnValue(new Promise(() => {}));
      await render();
      await act(async () => {});
      expect((document.querySelector('[data-testid="review-action-publish"]') as HTMLButtonElement).disabled).toBe(true);
      expect(document.querySelector('[data-testid="review-action-blocked"]')?.textContent).toContain("made for instagram only");
    });

    it("shows no preview for a Mission without a Publishable", async () => {
      setupDefaultQuery();
      loadReviewContentMock.mockReturnValue(new Promise(() => {}));
      await render();
      expect(document.querySelector('[data-testid="publishable-preview"]')).toBeNull();
    });
  });

  describe("Embedded in the mission page", () => {
    const withPublish = (publish: Record<string, unknown>) => {
      const base = getReviewMock.getMockImplementation()!;
      getReviewMock.mockImplementation(async () => ({ ...(await base()), content: null, publish }));
    };
    const PUBLISH = {
      targets: ["instagram:myinsta", "pinterest:pins"],
      mapped: true,
      unmappedTargets: [],
      publisherReady: true,
      publications: [],
    };
    const renderEmbedded = async (autoPublish?: { checked: boolean; editable: boolean; onChange: () => void }) => {
      await act(async () => {
        root.render(
          <MissionReviewContent
            instanceId="instance-1"
            missionId="mission-1"
            aside={<div data-testid="aside-card">Mission details</div>}
            autoPublish={autoPublish}
          />,
        );
      });
      await act(async () => {});
    };
    const setStatus = (status: string) =>
      useQueryMock.mockImplementation((key: string) => {
        if (key === "missions.get") {
          return { ...MISSION_WITH_ARTIFACT, status, lastArtifact: { external: { service: "media", id: "42" }, publishable: { kind: "video", videoUrl: "https://cdn.example.com/v.mp4", caption: "Watch" } } };
        }
        if (key === "publishers.list") return { adapter: "postiz", ...PUBLISHER };
        return undefined;
      });

    it("has no header of its own, and puts the aside and the Publishing card in the right column", async () => {
      withPublish(PUBLISH);
      setStatus("to_validate");
      await renderEmbedded();
      expect(document.querySelector("h1")).toBeNull();
      const aside = document.querySelector("aside");
      expect(aside?.querySelector('[data-testid="aside-card"]')).not.toBeNull();
      expect(aside?.querySelector('[data-testid="publish-section"]')).not.toBeNull();
      expect(document.querySelector('[data-testid="publishable-preview"]')?.textContent).toContain("Final video");
    });

    it("shows the Publishing card as the editor while validating: channels, date, and Auto-publish as a value", async () => {
      withPublish(PUBLISH);
      setStatus("to_validate");
      await renderEmbedded({ checked: false, editable: false, onChange: vi.fn() });
      const card = document.querySelector('[data-testid="publish-section"]')!;
      expect(card.querySelector('[data-testid="publish-channel-select"]')).not.toBeNull();
      expect(card.querySelector('[data-testid="publish-chip-instagram:myinsta"]')?.textContent).toContain("@myinsta");
      expect(card.querySelector('[data-testid="publish-at"]')).not.toBeNull();
      expect(card.querySelector('[data-testid="publish-auto"]')?.textContent).toBe("Off");
      expect(card.querySelector('[data-testid="publish-readonly"]')).toBeNull();
    });

    it("keeps the Publishing card a read-only summary once the Mission is no longer reviewable", async () => {
      withPublish(PUBLISH);
      setStatus("done");
      await renderEmbedded({ checked: false, editable: false, onChange: vi.fn() });
      const card = document.querySelector('[data-testid="publish-section"]')!;
      expect(card.querySelector('[data-testid="publish-row-instagram:myinsta"]')?.textContent).toContain("@myinsta");
      expect(card.querySelector('[data-testid="publish-row-pinterest:pins"]')?.textContent).toContain("@pins");
      expect(card.querySelector('[data-testid="publish-at-readonly"]')?.textContent).toBe("Immediately");
      expect(card.querySelector('[data-testid="publish-channel-select"]')).toBeNull();
      expect(card.querySelector('[data-testid="publish-at"]')).toBeNull();
    });

    it("is still the editor at the To publish step", async () => {
      withPublish(PUBLISH);
      setStatus("approved");
      await renderEmbedded();
      const card = document.querySelector('[data-testid="publish-section"]')!;
      expect(card.querySelector('[data-testid="publish-channel-select"]')).not.toBeNull();
      expect(card.querySelector('[data-testid="publish-at"]')).not.toBeNull();
      expect(card.querySelector('[data-testid="publish-readonly"]')).toBeNull();
    });

    it.each(["done", "failed", "doing"])("only shows the deliverable and the summary on a %s Mission: no review bar, no editor (what /view was for)", async (status) => {
      withPublish({ ...PUBLISH, publications: [] });
      setStatus(status);
      await renderEmbedded({ checked: true, editable: false, onChange: vi.fn() });
      expect(document.querySelector('[data-testid="publishable-preview"] video')).not.toBeNull();
      expect(document.querySelector('[data-testid="review-bar"]')).toBeNull();
      expect(document.querySelector('[data-testid="review-action-approve"]')).toBeNull();
      expect(document.querySelector('[data-testid="reject-button"]')).toBeNull();
      expect(document.querySelector('[data-testid="publish-channel-select"]')).toBeNull();
      expect(document.querySelector('[data-testid="publish-auto"]')?.textContent).toBe("On");
    });

    it("shows the review bar with Approve / Reject while validating, and the publish bar at To publish", async () => {
      withPublish(PUBLISH);
      setStatus("to_validate");
      await renderEmbedded();
      expect(document.querySelector('[data-testid="review-bar"]')?.textContent).toContain("Ready for review");
      expect(document.querySelector('[data-testid="review-action-approve"]')).not.toBeNull();
      expect(document.querySelector('[data-testid="reject-button"]')).not.toBeNull();
      setStatus("approved");
      await renderEmbedded();
      expect(document.querySelector('[data-testid="review-bar"]')?.textContent).toContain("Ready to publish");
    });

    it("puts the review bar first, above the deliverable, and keeps Reject an outline button", async () => {
      withPublish(PUBLISH);
      setStatus("to_validate");
      await renderEmbedded();
      const bar = document.querySelector('[data-testid="review-bar"]')!;
      const preview = document.querySelector('[data-testid="publishable-preview"]')!;
      // DOCUMENT_POSITION_FOLLOWING: the preview comes after the bar.
      expect(bar.compareDocumentPosition(preview) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      const reject = document.querySelector('[data-testid="reject-button"]') as HTMLElement;
      expect(reject.className).not.toContain("text-destructive");
    });

    it("keeps the review on screen while it is read again after an update, instead of flashing through Loading review", async () => {
      withPublish(PUBLISH);
      setStatus("to_validate");
      await renderEmbedded();
      expect(document.querySelector('[data-testid="publish-section"]')).not.toBeNull();

      // A channel is saved in Publishing: the Mission's updatedAt moves and the projection is read again, slowly.
      const base = getReviewMock.getMockImplementation()!;
      let answer!: () => void;
      getReviewMock.mockImplementation(() => new Promise((resolve) => { answer = () => resolve(base()); }));
      const query = useQueryMock.getMockImplementation()!;
      useQueryMock.mockImplementation((key: string, ...rest: unknown[]) =>
        key === "missions.get" ? { ...(query(key, ...rest) as object), updatedAt: Date.now() + 1000 } : query(key, ...rest),
      );
      await renderEmbedded();

      expect(document.body.textContent).not.toContain("Loading review");
      expect(document.querySelector('[data-testid="publish-section"]')).not.toBeNull();
      expect(document.querySelector('[data-testid="publishable-preview"]')).not.toBeNull();

      await act(async () => { answer(); });
      expect(document.querySelector('[data-testid="publish-section"]')).not.toBeNull();
    });
  });

  const PUBLISHER = {
    url: "https://postiz.example.com",
    hasApiKey: true,
    targets: [
      { target: "instagram:myinsta", mapped: true, channelId: "c1", channelName: "My IG", channelService: "instagram", channelProfile: "myinsta" },
      { target: "pinterest:pins", mapped: true, channelId: "c2", channelName: "Pins", channelService: "pinterest", channelProfile: "pins" },
    ],
  };

  describe("Publish target (ADR-069)", () => {
    // The channels and the date can be changed while the Mission is reviewable (To validate and To publish).
    const TO_PUBLISH = { ...MISSION_WITH_ARTIFACT, status: "approved" };

    function withPublish(mapped: boolean) {
      const base = getReviewMock.getMockImplementation()!;
      getReviewMock.mockImplementation(async () => ({
        ...(await base()),
        publish: {
          targets: ["instagram:myinsta"],
          mapped,
          unmappedTargets: mapped ? [] : ["instagram:myinsta"],
          publisherReady: true,
          publications: [{ target: "instagram:myinsta", status: "failed", error: "Postiz responded 500" }],
        },
      }));
      useQueryMock.mockImplementation((key: string) => {
        if (key === "missions.get") return TO_PUBLISH;
        if (key === "publishers.list") return PUBLISHER;
        if (key === "publications.listForMission") {
          return [{ id: "p1", target: "instagram:myinsta", status: "failed", error: "Postiz responded 500" }];
        }
        return undefined;
      });
      loadReviewContentMock.mockReturnValue(new Promise(() => {}));
    }

    it("links to the Publishers page when the target is not mapped, and lists Publications", async () => {
      withPublish(false);
      await render();
      await act(async () => {});
      const unmapped = document.querySelector('[data-testid="publish-unmapped"] a') as HTMLAnchorElement | null;
      expect(unmapped?.getAttribute("href")).toBe("/projects/instance-1/publishers");
      expect(document.querySelector('[data-testid="publication-instagram:myinsta"]')?.textContent).toContain("Failed");
    });

    it("disables a channel that cannot carry the Publishable kind and warns on an uncertain one", async () => {
      withPublish(true);
      const withKind = { ...TO_PUBLISH, lastArtifact: { external: { service: "media", id: "42" }, publishable: { kind: "image" } } };
      const publisher = {
        ...PUBLISHER,
        adapter: "postiz",
        targets: [
          ...PUBLISHER.targets,
          { target: "youtube:yt", mapped: true, channelId: "c3", channelName: "YT", channelService: "youtube", channelProfile: "yt" },
          { target: "mastodon:m", mapped: true, channelId: "c4", channelName: "M", channelService: "mastodon", channelProfile: "m" },
        ],
      };
      useQueryMock.mockImplementation((key: string) => {
        if (key === "missions.get") return withKind;
        if (key === "publishers.list") return publisher;
        return undefined;
      });
      await render();
      await act(async () => {});
      await openChannelList();
      expect(isDisabled(channelItem("youtube:yt")!)).toBe(true);
      expect(document.querySelector('[data-testid="publish-target-reason-youtube:yt"]')?.textContent).toContain("YouTube cannot publish an image");
      expect(isDisabled(channelItem("mastodon:m")!)).toBe(false);
      expect(document.querySelector('[data-testid="publish-target-warning-mastodon:m"]')).not.toBeNull();
    });

    it("shows the publication section, editable, while the Mission is being validated", async () => {
      withPublish(true);
      useQueryMock.mockImplementation((key: string) => {
        if (key === "missions.get") return MISSION_WITH_ARTIFACT;
        if (key === "publishers.list") return PUBLISHER;
        return undefined;
      });
      await render();
      await act(async () => {});
      expect(MISSION_WITH_ARTIFACT.status).toBe("to_validate");
      expect(document.querySelector('[data-testid="publish-section"]')).not.toBeNull();
      expect(document.querySelector('[data-testid="publish-channel-select"]')).not.toBeNull();
    });

    it("shows no unmapped warning once the target is mapped", async () => {
      withPublish(true);
      await render();
      await act(async () => {});
      expect(document.querySelector('[data-testid="publish-section"]')).not.toBeNull();
      expect(document.querySelector('[data-testid="publish-unmapped"]')).toBeNull();
    });

    it("shows the Mission's channels as chips and lists every channel of the Publisher with logo and handle", async () => {
      withPublish(true);
      await render();
      await act(async () => {});
      expect(channelChip("instagram:myinsta")?.textContent).toContain("@myinsta");
      expect(channelChip("pinterest:pins")).toBeNull();
      expect(document.querySelector('[data-testid="publish-section"] img')?.getAttribute("src")).toBe(
        "https://postiz.example.com/icons/platforms/instagram.png",
      );
      await openChannelList();
      expect(channelItem("pinterest:pins")?.textContent).toContain("@pins");
      expect(document.querySelector('[role="checkbox"]')).toBeNull();
    });

    it("lets the reviewer pick several channels, and refuses to empty the list", async () => {
      withPublish(true);
      const setTargets = vi.fn().mockResolvedValue(undefined);
      useMutationMock.mockImplementation((key: string) => (key === "publications.setTargets" ? setTargets : vi.fn()));
      await render();
      await act(async () => {});
      await openChannelList();
      await act(async () => { channelItem("pinterest:pins")!.click(); });
      expect(setTargets).toHaveBeenCalledWith({ missionId: "mission-1", targets: ["instagram:myinsta", "pinterest:pins"] });
      expect(document.querySelector('[data-testid="publish-summary"]')?.textContent).toContain("instagram:myinsta, pinterest:pins");

      setTargets.mockClear();
      await removeChip("instagram:myinsta");
      expect(setTargets).toHaveBeenCalledWith({ missionId: "mission-1", targets: ["pinterest:pins"] });
      setTargets.mockClear();
      await removeChip("pinterest:pins");
      expect(setTargets).not.toHaveBeenCalled();
      expect(document.body.textContent).toContain("Choose at least one channel");
    });

    it("names the unmapped target in the warning", async () => {
      withPublish(false);
      await render();
      await act(async () => {});
      expect(document.querySelector('[data-testid="publish-unmapped"]')?.textContent).toContain("instagram");
    });

    describe("date picker", () => {
      afterEach(() => { vi.useRealTimers(); });

      const openDatePicker = async () => {
        await act(async () => {
          (document.querySelector('[data-testid="publish-at"]') as HTMLElement).click();
        });
      };
      const dayButton = (date: Date) =>
        Array.from(document.querySelectorAll<HTMLButtonElement>("button[data-day]")).find(
          (b) => b.getAttribute("data-day") === date.toLocaleDateString(undefined),
        )!;

      it("lets the reviewer schedule the publication from the calendar, and clear it to publish immediately", async () => {
        withPublish(true);
        const setter = vi.fn().mockResolvedValue(undefined);
        useMutationMock.mockImplementation(() => setter);
        await render();
        await act(async () => {});
        vi.useFakeTimers({ toFake: ["Date"] });
        vi.setSystemTime(new Date(2030, 0, 1, 8, 0));
        expect(document.querySelector('[data-testid="publish-at"]')?.textContent).toContain("Publish immediately");
        await openDatePicker();
        await act(async () => { dayButton(new Date(2030, 0, 15)).click(); });
        expect(setter).toHaveBeenCalledWith({ missionId: "mission-1", publishAt: new Date(2030, 0, 15, 9, 0).getTime() });
        const clear = Array.from(document.querySelectorAll("button")).find((b) => b.textContent?.includes("Clear"))!;
        await act(async () => { clear.click(); });
        expect(setter).toHaveBeenLastCalledWith({ missionId: "mission-1", publishAt: null });
      });

      it("refuses a moment in the past before submitting and shows the message", async () => {
        withPublish(true);
        const setter = vi.fn().mockResolvedValue(undefined);
        useMutationMock.mockImplementation(() => setter);
        await render();
        await act(async () => {});
        vi.useFakeTimers({ toFake: ["Date"] });
        vi.setSystemTime(new Date(2030, 0, 1, 23, 30));
        await openDatePicker();
        // Today at the default time (the next full hour, past midnight) is already behind.
        await act(async () => { dayButton(new Date(2030, 0, 1)).click(); });
        expect(setter).not.toHaveBeenCalled();
        expect(document.body.textContent).toContain("publishAt must be in the future");
      });
    });

    it("shows the scheduled date of a scheduled Publication", async () => {
      const base = getReviewMock.getMockImplementation()!;
      getReviewMock.mockImplementation(async () => ({
        ...(await base()),
        publish: {
          mapped: true,
          targets: ["instagram:myinsta"],
          unmappedTargets: [],
          publisherReady: true,
          publishAt: new Date("2030-01-02T09:30").getTime(),
          publications: [{ target: "instagram:myinsta", status: "scheduled", scheduledAt: new Date("2030-01-02T09:30").getTime() }],
        },
      }));
      useQueryMock.mockImplementation((key: string) => {
        if (key === "missions.get") return TO_PUBLISH;
        if (key === "publishers.list") return PUBLISHER;
        if (key === "publications.listForMission") {
          return [{ id: "p1", target: "instagram:myinsta", status: "scheduled", scheduledAt: new Date("2030-01-02T09:30").getTime() }];
        }
        return undefined;
      });
      loadReviewContentMock.mockReturnValue(new Promise(() => {}));
      await render();
      await act(async () => {});
      expect(document.querySelector('[data-testid="publish-at"]')?.textContent).toContain(
        new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date("2030-01-02T09:30")),
      );
      expect(document.querySelector('[data-testid="publication-instagram:myinsta"]')?.textContent).toContain("Scheduled");
    });

    it("has no publish section for a Mission type without publish", async () => {
      setupDefaultQuery();
      loadReviewContentMock.mockReturnValue(new Promise(() => {}));
      await render();
      expect(document.querySelector('[data-testid="publish-section"]')).toBeNull();
    });
  });

  it("shows keyword and articleId from artifact metadata", async () => {
    setupDefaultQuery();
    loadReviewContentMock.mockReturnValue(new Promise(() => {}));
    await render();

    expect(document.body.textContent).toContain("SEO tips");
    expect(document.body.textContent).toContain("art-123");
  });

  it("renders the cover URL returned by the generic review content loader", async () => {
    setupDefaultQuery();
    loadReviewContentMock.mockResolvedValue({
      kind: "markdown",
      content: "# Article",
      metadata: {},
      coverUrl: "http://localhost:4000/images/art-123/cover",
    });
    await render();
    await act(async () => {});

    const img = document.querySelector('[data-testid="review-cover"]') as HTMLImageElement | null;
    expect(img).not.toBeNull();
    expect(img?.alt).toBe("Cover");
    expect(img?.src).toBe("http://localhost:4000/images/art-123/cover");
  });

  it("shows score from artifact metadata", async () => {
    setupDefaultQuery();
    loadReviewContentMock.mockReturnValue(new Promise(() => {}));
    await render();

    expect(document.body.textContent).toContain("87");
  });

  it("shows RunResult additionalDetails in the Engagement Report", async () => {
    const socialMission = {
      ...MISSION_WITH_ARTIFACT,
      type: "engage",
      templateId: "@opengroow/engagement",
      lastResult: {
        status: "success",
        summary: "Session complete",
        additionalDetails: {
          postsProcessed: 4,
          reportPath: "missions/mission-1/artifacts/run-1/report.json",
        },
        artifact: {
          kind: "metadata",
          external: { service: "workspace", id: "missions/mission-1/artifacts/run-1/report.json" },
        },
      },
    };
    useQueryMock.mockImplementation((key: string) => {
      if (key === "missions.get") return socialMission;
      return undefined;
    });
    loadReviewContentMock.mockResolvedValue({
      kind: "metadata",
      content: JSON.stringify({ summary: { skipped: 1 }, posts: [] }),
      metadata: {},
    });
    await render();
    await act(async () => {});

    expect(document.body.textContent).toContain("Additional details");
    expect(document.body.textContent).toContain("postsProcessed");
    expect(document.body.textContent).toContain("reportPath");
  });

  it("renders an engagement report in read-only view with the current actions object shape", async () => {
    const socialMission = {
      ...MISSION_WITH_ARTIFACT,
      type: "engage",
      templateId: "@opengroow/engagement",
      lastResult: {
        status: "success",
        summary: "Session complete",
        artifact: {
          kind: "metadata",
          external: { service: "workspace", id: "missions/mission-1/artifacts/run-1/report.json" },
        },
      },
    };
    useQueryMock.mockImplementation((key: string) => {
      if (key === "missions.get") return socialMission;
      return undefined;
    });
    loadReviewContentMock.mockResolvedValue({
      kind: "metadata",
      content: JSON.stringify({
        stats: { liked: 1, skipped: 0 },
        posts: [
          {
            postSummary: { accountHandle: "example" },
            agentEvaluation: { decision: "liked" },
            actions: { liked: true, followed: false, commented: false },
          },
        ],
      }),
      metadata: {},
    });

    await render();
    await act(async () => {});

    expect(document.body.textContent).toContain("Posts (1)");
    expect(document.body.textContent).toContain("@example");
    expect(document.body.textContent).not.toContain("actions.find");
  });

  it("shows each post's Visual Description, or why the VLM produced none", async () => {
    const socialMission = {
      ...MISSION_WITH_ARTIFACT,
      type: "engage",
      templateId: "@opengroow/engagement",
      lastResult: {
        status: "success",
        summary: "Session complete",
        artifact: {
          kind: "metadata",
          external: { service: "workspace", id: "missions/mission-1/artifacts/run-1/report.json" },
        },
      },
    };
    useQueryMock.mockImplementation((key: string) => {
      if (key === "missions.get") return socialMission;
      return undefined;
    });
    loadReviewContentMock.mockResolvedValue({
      kind: "metadata",
      content: JSON.stringify({
        stats: { liked: 1, skipped: 1 },
        posts: [
          {
            postSummary: { accountHandle: "described" },
            agentEvaluation: { decision: "liked" },
            visualDescription: "Handwritten note: I miss you like crazy",
            visualDescriptionStatus: { ok: true, latencyMs: 2100 },
          },
          {
            postSummary: { accountHandle: "undescribed" },
            agentEvaluation: { decision: "skipped" },
            visualDescriptionStatus: { ok: false, reason: "unreachable", latencyMs: 3 },
          },
        ],
      }),
      metadata: {},
    });

    await render();
    await act(async () => {});

    const text = document.body.textContent ?? "";
    expect(text).toContain("Visual description");
    expect(text).toContain("Handwritten note: I miss you like crazy");
    expect(text).toContain("unavailable (unreachable)");
  });

  it("shows jev's scores on each post, or why jev was unavailable", async () => {
    const socialMission = {
      ...MISSION_WITH_ARTIFACT,
      type: "engage",
      templateId: "@opengroow/engagement",
      lastResult: {
        status: "success",
        summary: "Session complete",
        artifact: {
          kind: "metadata",
          external: { service: "workspace", id: "missions/mission-1/artifacts/run-1/report.json" },
        },
      },
    };
    useQueryMock.mockImplementation((key: string) => {
      if (key === "missions.get") return socialMission;
      return undefined;
    });
    loadReviewContentMock.mockResolvedValue({
      kind: "metadata",
      content: JSON.stringify({
        stats: { liked: 1, skipped: 1 },
        posts: [
          {
            postSummary: { accountHandle: "scored" },
            agentEvaluation: { decision: "liked" },
            classifierEvaluation: { status: "available", shouldLikeScore: 0.714, shouldCommentScore: 0.31 },
          },
          {
            postSummary: { accountHandle: "unscored" },
            agentEvaluation: { decision: "skipped" },
            classifierEvaluation: { status: "unavailable", failureReason: "classification_unavailable" },
          },
        ],
      }),
      metadata: {},
    });

    await render();
    await act(async () => {});

    const text = document.body.textContent ?? "";
    expect(text).toContain("jev · like 0.71 · comment 0.31");
    expect(text).toContain("jev unavailable (classification_unavailable)");
  });

  it("shows each anchor repair recorded for a post", async () => {
    useQueryMock.mockImplementation((key: string) => {
      if (key === "missions.get") {
        return {
          ...MISSION_WITH_ARTIFACT,
          type: "engage",
          templateId: "@opengroow/engagement",
          lastResult: {
            status: "success",
            summary: "Session complete",
            artifact: {
              kind: "metadata",
              external: { service: "workspace", id: "missions/mission-1/artifacts/run-1/report.json" },
            },
          },
        };
      }
      return undefined;
    });
    loadReviewContentMock.mockResolvedValue({
      kind: "metadata",
      content: JSON.stringify({
        stats: { liked: 1 },
        posts: [
          {
            postSummary: { accountHandle: "repaired" },
            agentEvaluation: { decision: "liked" },
            anchorRepairs: [
              {
                field: "postLikeCountResourceId",
                from: "com.zhiliaoapp.musically:id/g5s",
                to: "com.zhiliaoapp.musically:id/g6s",
                confidence: 0.912,
                outcome: "persisted",
              },
              { field: "postCaptionResourceId", from: null, to: null, confidence: null, outcome: "no_candidate" },
            ],
          },
        ],
      }),
      metadata: {},
    });

    await render();
    await act(async () => {});

    const text = document.body.textContent ?? "";
    expect(text).toContain("Anchor repaired · postLikeCountResourceId g5s → g6s (0.91)");
    expect(text).toContain("Anchor repair failed · postCaptionResourceId (no_candidate)");
  });

  it("shows loading state while article content is being fetched", async () => {
    setupDefaultQuery();
    loadReviewContentMock.mockReturnValue(new Promise(() => {}));
    await render();

    expect(document.body.textContent).toMatch(/loading/i);
  });

  it("calls loadReviewContent with the missionId on mount", async () => {
    setupDefaultQuery();
    loadReviewContentMock.mockResolvedValue({ kind: "markdown", content: "# Article", metadata: {} });
    await render();

    await act(async () => {});

    expect(loadReviewContentMock).toHaveBeenCalledWith({ missionId: "mission-1" });
  });

  it("renders article markdown content when loadReviewContent resolves", async () => {
    setupDefaultQuery();
    loadReviewContentMock.mockResolvedValue({ kind: "markdown", content: "# My Article\n\nGreat content here.", metadata: {} });
    await render();

    await act(async () => {});

    const markdownEl = document.querySelector('[data-testid="markdown"]');
    expect(markdownEl).not.toBeNull();
    expect(markdownEl!.textContent).toContain("# My Article");
  });

  it("shows the deliverable without review or publish actions once the Mission is done", async () => {
    useQueryMock.mockImplementation((key: string) => (key === "missions.get" ? { ...MISSION_WITH_ARTIFACT, status: "done" } : undefined));
    loadReviewContentMock.mockResolvedValue({ kind: "markdown", content: "# My Article", metadata: {} });
    await render();
    await act(async () => {});

    expect(document.querySelector('[data-testid="markdown"]')?.textContent).toContain("# My Article");
    expect(document.querySelectorAll("button")).toHaveLength(0);
    expect(document.querySelector('[data-testid="review-action-approve"]')).toBeNull();
    expect(document.querySelector('[data-testid="review-action-publish"]')).toBeNull();
  });

  it("shows error when loadReviewContent fails", async () => {
    setupDefaultQuery();
    loadReviewContentMock.mockRejectedValue(new Error("article-mcp unreachable"));
    await render();

    await act(async () => {});

    expect(document.body.textContent).toContain("article-mcp unreachable");
  });

  // ---------------------------------------------------------------------------
  // Generic review action affordances (SEO approve / publish via performReviewAction)
  // ---------------------------------------------------------------------------

  it("shows enabled Approve and Reject buttons (English labels)", async () => {
    setupDefaultQuery();
    loadReviewContentMock.mockReturnValue(new Promise(() => {}));
    performReviewActionMock.mockResolvedValue({ ok: true });
    await render();

    const buttons = Array.from(document.querySelectorAll("button"));
    const approveBtn = buttons.find((b) => b.textContent?.includes("Approve"));
    const rejectBtn = buttons.find((b) => b.textContent?.includes("Reject"));

    expect(approveBtn).toBeTruthy();
    expect(approveBtn?.disabled).toBe(false);
    expect(rejectBtn).toBeTruthy();
    expect(rejectBtn?.disabled).toBe(false);
  });

  it("clicking Reject reveals a feedback textarea", async () => {
    setupDefaultQuery();
    loadReviewContentMock.mockReturnValue(new Promise(() => {}));
    await render();

    expect(document.querySelector("textarea")).toBeNull();

    const rejectBtn = Array.from(document.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Reject"),
    );
    await act(async () => {
      rejectBtn?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(document.querySelector("textarea")).not.toBeNull();
  });

  it("confirm rejection is disabled until feedback is non-empty", async () => {
    setupDefaultQuery();
    loadReviewContentMock.mockReturnValue(new Promise(() => {}));
    await render();

    const rejectBtn = Array.from(document.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Reject"),
    );
    await act(async () => {
      rejectBtn?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const confirmBtn = Array.from(document.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Confirm rejection"),
    );
    expect(confirmBtn?.disabled).toBe(true);

    const textarea = document.querySelector("textarea")!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        "value",
      )!.set!;
      setter.call(textarea, "Make the tone friendlier");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });

    const confirmBtnAfter = Array.from(document.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Confirm rejection"),
    );
    expect(confirmBtnAfter?.disabled).toBe(false);
  });

  it("confirming rejection calls performReviewAction with actionKey reject and feedback", async () => {
    setupDefaultQuery();
    loadReviewContentMock.mockReturnValue(new Promise(() => {}));
    performReviewActionMock.mockResolvedValue({ ok: true });
    await render();

    const rejectBtn = Array.from(document.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Reject"),
    );
    await act(async () => {
      rejectBtn?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const textarea = document.querySelector('[data-testid="reject-feedback"]') as HTMLTextAreaElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        "value",
      )!.set!;
      setter.call(textarea, "Make the tone friendlier");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });

    const confirmBtn = Array.from(document.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Confirm rejection"),
    );
    await act(async () => {
      confirmBtn?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {});

    expect(performReviewActionMock).toHaveBeenCalledWith({
      missionId: "mission-1",
      actionKey: "reject",
      input: { feedback: "Make the tone friendlier" },
    });
    expect(routerPushMock).toHaveBeenCalledWith("/projects/instance-1/missions");
  });

  it("shows error message when rejection via performReviewAction fails", async () => {
    setupDefaultQuery();
    loadReviewContentMock.mockReturnValue(new Promise(() => {}));
    performReviewActionMock.mockImplementation((args: Record<string, unknown>) => {
      if (args.actionKey === "reject") return Promise.reject(new Error("rejection failed"));
      return Promise.resolve({ ok: true });
    });
    await render();

    const rejectBtn = Array.from(document.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Reject"),
    );
    await act(async () => {
      rejectBtn?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const textarea = document.querySelector('[data-testid="reject-feedback"]') as HTMLTextAreaElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        "value",
      )!.set!;
      setter.call(textarea, "Needs work");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });

    const confirmBtn = Array.from(document.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Confirm rejection"),
    );
    await act(async () => {
      confirmBtn?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {});

    expect(document.body.textContent).toContain("rejection failed");
    expect(routerPushMock).not.toHaveBeenCalled();
  });

  it("clicking Approve calls performReviewAction with actionKey 'approve' and redirects", async () => {
    setupDefaultQuery();
    loadReviewContentMock.mockReturnValue(new Promise(() => {}));
    performReviewActionMock.mockResolvedValue({ ok: true });

    await render();

    const approveBtn = Array.from(document.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Approve"),
    );
    await act(async () => {
      approveBtn?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {});

    expect(performReviewActionMock).toHaveBeenCalledWith({
      missionId: "mission-1",
      actionKey: "approve",
    });
    expect(routerPushMock).toHaveBeenCalledWith("/projects/instance-1/missions");
  });

  it("shows error message when performReviewAction fails on approve", async () => {
    setupDefaultQuery();
    loadReviewContentMock.mockReturnValue(new Promise(() => {}));
    performReviewActionMock.mockRejectedValue(new Error("article-mcp unreachable"));

    await render();

    const approveBtn = Array.from(document.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Approve"),
    );
    await act(async () => {
      approveBtn?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {});

    expect(document.body.textContent).toContain("article-mcp unreachable");
    expect(routerPushMock).not.toHaveBeenCalled();
  });

  it("shows only Publish button for approved SEO missions", async () => {
    useQueryMock.mockImplementation((key: string) => {
      if (key === "missions.get") {
        return { ...MISSION_WITH_ARTIFACT, status: "approved" };
      }
      return undefined;
    });
    loadReviewContentMock.mockReturnValue(new Promise(() => {}));
    await render();

    const buttons = Array.from(document.querySelectorAll("button"));
    const publierBtn = buttons.find((b) => b.textContent?.includes("Publish"));
    const approuverBtn = buttons.find((b) => b.textContent?.includes("Approve"));
    // Reject only shown from to_validate
    const rejeterBtn = buttons.find((b) => b.textContent?.includes("Reject"));

    expect(publierBtn).toBeTruthy();
    expect(approuverBtn).toBeFalsy();
    expect(rejeterBtn).toBeFalsy();
    expect(document.querySelector('[data-testid="action-input-publishDate"]')).not.toBeNull();
  });

  it("clicking Publish calls performReviewAction with actionKey 'publish' and redirects", async () => {
    performReviewActionMock.mockResolvedValue({ ok: true });
    useQueryMock.mockImplementation((key: string) => {
      if (key === "missions.get") {
        return { ...MISSION_WITH_ARTIFACT, status: "approved" };
      }
      return undefined;
    });
    loadReviewContentMock.mockReturnValue(new Promise(() => {}));
    await render();

    const publierBtn = Array.from(document.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Publish"),
    );
    await act(async () => {
      publierBtn?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {});

    expect(performReviewActionMock).toHaveBeenCalledWith({
      missionId: "mission-1",
      actionKey: "publish",
    });
    expect(routerPushMock).toHaveBeenCalledWith("/projects/instance-1/missions");
  });

  it("shows error message when performReviewAction fails on publish", async () => {
    useQueryMock.mockImplementation((key: string) => {
      if (key === "missions.get") {
        return { ...MISSION_WITH_ARTIFACT, status: "approved" };
      }
      return undefined;
    });
    loadReviewContentMock.mockReturnValue(new Promise(() => {}));
    performReviewActionMock.mockRejectedValue(new Error("GitHub push failed"));

    await render();

    const publierBtn = Array.from(document.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Publish"),
    );
    await act(async () => {
      publierBtn?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {});

    expect(document.body.textContent).toContain("GitHub push failed");
    expect(routerPushMock).not.toHaveBeenCalled();
  });

  it("renders no deliverable when lastResult has no artifact", async () => {
    useQueryMock.mockImplementation((key: string) => {
      if (key === "missions.get") {
        return {
          ...MISSION_WITH_ARTIFACT,
          lastResult: {
            status: "needs_human_review",
            summary: "No artifact",
            reviewQuestions: [],
          },
        };
      }
      return undefined;
    });

    await render();
    await act(async () => {});

    expect(document.querySelector('[data-testid="markdown"]')).toBeNull();
    expect(document.querySelector('[data-testid="publishable-preview"]')).toBeNull();
    expect(loadReviewContentMock).not.toHaveBeenCalled();
  });

  const CAROUSEL_MISSION_TO_VALIDATE = {
    _id: "mission-carousel-1",
    instanceId: "instance-1",
    type: "create_carousel",
    status: "to_validate",
    templateId: "@opengroow/visual-social",
    createdAt: Date.now(),
    lastResult: {
      status: "needs_human_review",
      summary: "Carousel ready for review",
      reviewQuestions: [],
      artifact: {
        kind: "image",
        external: { service: "carousel-mcp", id: "carousel-123" },
        metadata: {},
      },
    },
  };

  it("renders each Carousel slide and platform image from the image review contract", async () => {
    useQueryMock.mockImplementation((key: string) => {
      if (key === "missions.get") return CAROUSEL_MISSION_TO_VALIDATE;
      return undefined;
    });
    loadReviewContentMock.mockResolvedValue({
      kind: "image",
      content: JSON.stringify({
        brief: "Focus tips",
        status: "created",
        platforms: ["instagram", "tiktok"],
        slides: [
          {
            text: "Start with one priority",
            imageUrls: {
              instagram: "http://localhost:4112/media/carousels/carousel-123/instagram/slide-1.png",
              tiktok: "http://localhost:4112/media/carousels/carousel-123/tiktok/slide-1.png",
            },
          },
        ],
      }),
      metadata: {},
    });

    await render();
    await act(async () => {});

    expect(document.querySelector('[data-testid="carousel-review-content"]')).not.toBeNull();
    expect(document.body.textContent).toContain("Start with one priority");
    expect(document.querySelector('[data-testid="carousel-image-1-instagram"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="carousel-image-1-tiktok"]')).not.toBeNull();
  });

  it("approving a Carousel calls the publish effect and completes the review", async () => {
    const performMock = vi.fn().mockResolvedValue({ ok: true });
    useQueryMock.mockImplementation((key: string) => {
      if (key === "missions.get") return CAROUSEL_MISSION_TO_VALIDATE;
      return undefined;
    });
    loadReviewContentMock.mockResolvedValue({
      kind: "image",
      content: JSON.stringify({
        platforms: ["instagram"],
        slides: [{ text: "Start", imageUrls: { instagram: "http://localhost:4112/media/slide-1.png" } }],
      }),
      metadata: {},
    });
    useActionMock.mockImplementation((action: string) => {
      if (action === "missions_node.getReview") return getReviewMock;
      if (action === "missions_node.loadReviewContent") return loadReviewContentMock;
      if (action === "missions_node.performReviewAction") return performMock;
      return vi.fn();
    });

    await render();
    await act(async () => {});

    const approveButton = Array.from(document.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("Approve and publish"),
    );
    expect(approveButton).toBeTruthy();
    await act(async () => {
      approveButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {});

    expect(performMock).toHaveBeenCalledWith({ missionId: "mission-1", actionKey: "approve" });
    expect(routerPushMock).toHaveBeenCalledWith("/projects/instance-1/missions");
  });

  it("blocks approval and explains missing platform variants", async () => {
    useQueryMock.mockImplementation((key: string) => {
      if (key === "missions.get") return CAROUSEL_MISSION_TO_VALIDATE;
      return undefined;
    });
    loadReviewContentMock.mockResolvedValue({
      kind: "image",
      content: JSON.stringify({
        platforms: ["instagram", "tiktok"],
        slides: [{ text: "Start", imageUrls: { instagram: "http://localhost:4112/media/slide-1.png" } }],
      }),
      metadata: {},
    });

    await render();
    await act(async () => {});

    expect(document.querySelector('[data-testid="carousel-missing-images"]')?.textContent).toContain("tiktok");
    expect((document.querySelector('[data-testid="review-action-approve"]') as HTMLButtonElement).disabled).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // Video template branch — generic review path (ADR-020)
  // Video content is loaded via loadReviewContent returning { kind: "video",
  // content: <url> }. The generic renderer shows <video data-testid="review-video">.
  // ---------------------------------------------------------------------------

  const VIDEO_MISSION_TO_VALIDATE = {
    _id: "mission-video-1",
    instanceId: "instance-1",
    type: "create_video",
    status: "to_validate",
    templateId: "@opengroow/video-demo",
    createdAt: Date.now(),
    lastResult: {
      status: "needs_human_review",
      summary: "Video ready for review",
      reviewQuestions: [],
      artifact: {
        kind: "video",
        external: { service: "video-mcp", id: "run-uuid-video-1" },
        metadata: { runId: "run-uuid-video-1" },
      },
    },
  };

  it("renders <video> element via generic renderer for video mission in to_validate", async () => {
    useQueryMock.mockImplementation((key: string) => {
      if (key === "missions.get") return VIDEO_MISSION_TO_VALIDATE;
      return undefined;
    });
    loadReviewContentMock.mockResolvedValue({
      kind: "video",
      content: "https://video-mcp.test/videos/run-uuid-video-1/final",
      metadata: { runId: "run-uuid-video-1" },
    });

    await render();
    await act(async () => {});

    const videoEl = document.querySelector('[data-testid="review-video"]');
    expect(videoEl).not.toBeNull();
    expect(videoEl?.getAttribute("src")).toBe("https://video-mcp.test/videos/run-uuid-video-1/final");
    expect(loadReviewContentMock).toHaveBeenCalledWith({ missionId: "mission-1" });
  });

  it("shows Validate button for video mission in to_validate (label from template)", async () => {
    useQueryMock.mockImplementation((key: string) => {
      if (key === "missions.get") return VIDEO_MISSION_TO_VALIDATE;
      return undefined;
    });
    loadReviewContentMock.mockReturnValue(new Promise(() => {}));

    await render();

    const buttons = Array.from(document.querySelectorAll("button"));
    const validateBtn = buttons.find((b) => b.textContent?.includes("Validate"));
    expect(validateBtn).toBeTruthy();
  });

  it("Validate button calls performReviewAction with approve actionKey and redirects", async () => {
    useQueryMock.mockImplementation((key: string) => {
      if (key === "missions.get") return VIDEO_MISSION_TO_VALIDATE;
      return undefined;
    });
    loadReviewContentMock.mockReturnValue(new Promise(() => {}));
    performReviewActionMock.mockResolvedValue({ ok: true });

    await render();
    await act(async () => {});

    const validateBtn = Array.from(document.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Validate"),
    );
    await act(async () => {
      validateBtn?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {});

    expect(performReviewActionMock).toHaveBeenCalledWith({
      missionId: "mission-1",
      actionKey: "approve",
    });
    expect(routerPushMock).toHaveBeenCalledWith("/projects/instance-1/missions");
  });

  it("renders <video> via generic renderer for approved video mission", async () => {
    useQueryMock.mockImplementation((key: string) => {
      if (key === "missions.get") {
        return { ...VIDEO_MISSION_TO_VALIDATE, status: "approved" };
      }
      return undefined;
    });
    loadReviewContentMock.mockResolvedValue({
      kind: "video",
      content: "https://video-mcp.test/videos/run-uuid-video-1/final",
      metadata: { runId: "run-uuid-video-1" },
    });
    performReviewActionMock.mockResolvedValue({ ok: true });

    await render();
    await act(async () => {});

    const videoEl = document.querySelector('[data-testid="review-video"]');
    expect(videoEl).not.toBeNull();

    // shows Publish button, not Validate
    const publishBtn = Array.from(document.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Publish"),
    );
    expect(publishBtn).toBeTruthy();
  });

  it("does NOT render <video> for non-video template (seo) even with to_validate status", async () => {
    useQueryMock.mockImplementation((key: string) => {
      if (key === "missions.get") return MISSION_WITH_ARTIFACT; // templateId: "@opengroow/seo", status: "to_validate"
      return undefined;
    });
    loadReviewContentMock.mockReturnValue(new Promise(() => {}));

    await render();

    const videoEl = document.querySelector('[data-testid="review-video"]');
    expect(videoEl).toBeNull();
  });

  // ---------------------------------------------------------------------------
  // Video publish affordance (approved status) — generic performReviewAction
  // ---------------------------------------------------------------------------

  const VIDEO_MISSION_APPROVED = {
    _id: "mission-video-1",
    instanceId: "instance-1",
    type: "create_video",
    status: "approved",
    templateId: "@opengroow/video-demo",
    createdAt: Date.now(),
    lastResult: {
      status: "needs_human_review",
      summary: "Video approved",
      reviewQuestions: [],
      artifact: {
        kind: "video",
        external: { service: "video-mcp", id: "run-uuid-video-1" },
        metadata: { runId: "run-uuid-video-1" },
      },
    },
  };

  it("shows Publish button (not Validate) for approved video mission", async () => {
    useQueryMock.mockImplementation((key: string) => {
      if (key === "missions.get") return VIDEO_MISSION_APPROVED;
      return undefined;
    });
    loadReviewContentMock.mockReturnValue(new Promise(() => {}));
    performReviewActionMock.mockResolvedValue({ ok: true });

    await render();
    await act(async () => {});

    const buttons = Array.from(document.querySelectorAll("button"));
    const publishBtn = buttons.find((b) => b.textContent?.includes("Publish"));
    const validateBtn = buttons.find((b) => b.textContent?.includes("Validate"));
    expect(publishBtn).toBeTruthy();
    expect(validateBtn).toBeFalsy();
  });

  it("shows optional publish-date input for approved video mission", async () => {
    useQueryMock.mockImplementation((key: string) => {
      if (key === "missions.get") return VIDEO_MISSION_APPROVED;
      return undefined;
    });
    loadReviewContentMock.mockReturnValue(new Promise(() => {}));
    performReviewActionMock.mockResolvedValue({ ok: true });

    await render();
    await act(async () => {});

    const dateInput = document.querySelector('[data-testid="action-input-publishDate"]');
    expect(dateInput).not.toBeNull();
  });

  it("clicking Publish calls performReviewAction with publish actionKey without date when empty", async () => {
    const performMock = vi.fn().mockResolvedValue({ ok: true });
    useQueryMock.mockImplementation((key: string) => {
      if (key === "missions.get") return VIDEO_MISSION_APPROVED;
      return undefined;
    });
    loadReviewContentMock.mockReturnValue(new Promise(() => {}));
    useActionMock.mockImplementation((action: string) => {
      if (action === "missions_node.getReview") return getReviewMock;
      if (action === "missions_node.loadReviewContent") return loadReviewContentMock;
      if (action === "missions_node.performReviewAction") return performMock;
      return vi.fn();
    });

    await render();
    await act(async () => {});

    const publishBtn = Array.from(document.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Publish"),
    );
    await act(async () => {
      publishBtn?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {});

    // No input provided — should call without input field or with empty
    expect(performMock).toHaveBeenCalledWith(
      expect.objectContaining({ missionId: "mission-1", actionKey: "publish" }),
    );
    expect(routerPushMock).toHaveBeenCalledWith("/projects/instance-1/missions");
  });

  it("clicking Publish passes publishDate when date input is filled", async () => {
    const performMock = vi.fn().mockResolvedValue({ ok: true });
    useQueryMock.mockImplementation((key: string) => {
      if (key === "missions.get") return VIDEO_MISSION_APPROVED;
      return undefined;
    });
    loadReviewContentMock.mockReturnValue(new Promise(() => {}));
    useActionMock.mockImplementation((action: string) => {
      if (action === "missions_node.getReview") return getReviewMock;
      if (action === "missions_node.loadReviewContent") return loadReviewContentMock;
      if (action === "missions_node.performReviewAction") return performMock;
      return vi.fn();
    });

    await render();
    await act(async () => {});

    const dateInput = document.querySelector('[data-testid="action-input-publishDate"]') as HTMLInputElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      )!.set!;
      setter.call(dateInput, "2026-06-15T10:00");
      dateInput.dispatchEvent(new Event("input", { bubbles: true }));
    });

    const publishBtn = Array.from(document.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Publish"),
    );
    await act(async () => {
      publishBtn?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {});

    expect(performMock).toHaveBeenCalledWith({
      missionId: "mission-1",
      actionKey: "publish",
      input: { publishDate: "2026-06-15T10:00" },
    });
  });

  it("shows error message when performReviewAction fails for approved video publish", async () => {
    useQueryMock.mockImplementation((key: string) => {
      if (key === "missions.get") return VIDEO_MISSION_APPROVED;
      return undefined;
    });
    loadReviewContentMock.mockReturnValue(new Promise(() => {}));
    performReviewActionMock.mockRejectedValue(new Error("no scheduler channel configured"));

    await render();
    await act(async () => {});

    const publishBtn = Array.from(document.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Publish"),
    );
    await act(async () => {
      publishBtn?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {});

    expect(document.body.textContent).toContain("no scheduler channel configured");
    expect(routerPushMock).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // Video reject with feedback affordance (to_validate status)
  // ---------------------------------------------------------------------------

  it("shows Validate and Reject-with-feedback buttons for video mission in to_validate", async () => {
    useQueryMock.mockImplementation((key: string) => {
      if (key === "missions.get") return VIDEO_MISSION_TO_VALIDATE;
      return undefined;
    });
    loadReviewContentMock.mockReturnValue(new Promise(() => {}));

    await render();

    const buttons = Array.from(document.querySelectorAll("button"));
    const validateBtn = buttons.find((b) => b.textContent?.includes("Validate"));
    const rejectBtn = buttons.find((b) => b.textContent?.includes("Reject with feedback"));
    expect(validateBtn).toBeTruthy();
    expect(rejectBtn).toBeTruthy();
  });

  it("clicking Reject-with-feedback reveals a feedback textarea", async () => {
    useQueryMock.mockImplementation((key: string) => {
      if (key === "missions.get") return VIDEO_MISSION_TO_VALIDATE;
      return undefined;
    });
    loadReviewContentMock.mockReturnValue(new Promise(() => {}));

    await render();

    expect(document.querySelector('[data-testid="reject-feedback"]')).toBeNull();

    const rejectBtn = Array.from(document.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Reject with feedback"),
    );
    await act(async () => {
      rejectBtn?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(document.querySelector('[data-testid="reject-feedback"]')).not.toBeNull();
  });

  it("confirm video rejection is disabled until feedback is non-empty", async () => {
    useQueryMock.mockImplementation((key: string) => {
      if (key === "missions.get") return VIDEO_MISSION_TO_VALIDATE;
      return undefined;
    });
    loadReviewContentMock.mockReturnValue(new Promise(() => {}));

    await render();

    const rejectBtn = Array.from(document.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Reject with feedback"),
    );
    await act(async () => {
      rejectBtn?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const confirmBtn = Array.from(document.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Confirm rejection"),
    );
    expect(confirmBtn?.disabled).toBe(true);

    const textarea = document.querySelector('[data-testid="reject-feedback"]') as HTMLTextAreaElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        "value",
      )!.set!;
      setter.call(textarea, "The pacing is too fast");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });

    const confirmBtnAfter = Array.from(document.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Confirm rejection"),
    );
    expect(confirmBtnAfter?.disabled).toBe(false);
  });

  it("confirming video rejection calls performReviewAction with actionKey reject", async () => {
    useQueryMock.mockImplementation((key: string) => {
      if (key === "missions.get") return VIDEO_MISSION_TO_VALIDATE;
      return undefined;
    });
    loadReviewContentMock.mockReturnValue(new Promise(() => {}));
    performReviewActionMock.mockResolvedValue({ ok: true });

    await render();

    const rejectBtn = Array.from(document.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Reject with feedback"),
    );
    await act(async () => {
      rejectBtn?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const textarea = document.querySelector('[data-testid="reject-feedback"]') as HTMLTextAreaElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        "value",
      )!.set!;
      setter.call(textarea, "The pacing is too fast");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });

    const confirmBtn = Array.from(document.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Confirm rejection"),
    );
    await act(async () => {
      confirmBtn?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {});

    expect(performReviewActionMock).toHaveBeenCalledWith({
      missionId: "mission-1",
      actionKey: "reject",
      input: { feedback: "The pacing is too fast" },
    });
    expect(routerPushMock).toHaveBeenCalledWith("/projects/instance-1/missions");
  });

  it("shows error message when video rejection via performReviewAction fails", async () => {
    useQueryMock.mockImplementation((key: string) => {
      if (key === "missions.get") return VIDEO_MISSION_TO_VALIDATE;
      return undefined;
    });
    loadReviewContentMock.mockReturnValue(new Promise(() => {}));
    performReviewActionMock.mockImplementation((args: Record<string, unknown>) => {
      if (args.actionKey === "reject") return Promise.reject(new Error("video rejection failed"));
      return Promise.resolve({ ok: true });
    });

    await render();

    const rejectBtn = Array.from(document.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Reject with feedback"),
    );
    await act(async () => {
      rejectBtn?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const textarea = document.querySelector('[data-testid="reject-feedback"]') as HTMLTextAreaElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        "value",
      )!.set!;
      setter.call(textarea, "Needs work");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });

    const confirmBtn = Array.from(document.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Confirm rejection"),
    );
    await act(async () => {
      confirmBtn?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {});

    expect(document.body.textContent).toContain("video rejection failed");
    expect(routerPushMock).not.toHaveBeenCalled();
  });
});

describe("Review module architecture guard (#357)", () => {
  it("does not branch rendering, actions, or transitions on templateId", () => {
    const source = readFileSync(
      join(__dirname, "../src/components/mission-review-page.tsx"),
      "utf8",
    );
    // The only allowed reference is passing `templateId` straight through as
    // an opaque query argument (resolving the Template's manifest) — never
    // reading it to decide what to render or which action/transition is
    // available. Any comparison/branch on templateId reintroduces exactly
    // the coupling #357 removed.
    const templateIdBranchPattern =
      /templateId\s*(===|!==|==|!=)|\btemplateId\s*:\s*"[^"]|switch\s*\(\s*[\w.?]*templateId\s*\)|case\s+["'][^"']*["']\s*:.*templateId/;
    const offendingLines = source
      .split("\n")
      .map((line, index) => ({ line, number: index + 1 }))
      .filter(({ line }) => templateIdBranchPattern.test(line));

    expect(offendingLines, JSON.stringify(offendingLines)).toEqual([]);
  });
});
