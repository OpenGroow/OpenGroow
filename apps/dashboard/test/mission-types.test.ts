import { describe, it, expect } from "vitest";
import { manifestFixture } from "./fixtures/manifests";
import {
  missionTypesForManifest,
  validateMissionPayload,
  validateMissionPayloadUnlessRaw,
  visibleMissionTypes,
} from "../src/utils/mission-types";

const typesOf = (templateId: string) => missionTypesForManifest(manifestFixture(templateId));

describe("missionTypesForManifest", () => {
  it("returns the seo mission types from the seo manifest", () => {
    const seo = { manifest: manifestFixture("seo") };
    const types = missionTypesForManifest(seo.manifest);
    expect(types.map((t) => t.type)).toContain("create_article");
    expect(types.map((t) => t.type)).toContain("internal_linking");
  });

  it("returns the video mission types from the video manifest", () => {
    const video = { manifest: manifestFixture("video-demo") };
    const types = missionTypesForManifest(video.manifest);
    expect(types.map((t) => t.type)).toContain("lym_create_letter_video");
  });

  it("the lym_create_letter_video payload keeps both platforms in raw JSON", () => {
    const video = { manifest: manifestFixture("video-demo") };
    const createVideo = missionTypesForManifest(video.manifest).find((t) => t.type === "lym_create_letter_video");
    expect(createVideo).toBeDefined();
    const payload = JSON.parse(createVideo!.payload) as Record<string, unknown>;
    expect(payload.platforms).toEqual(["tiktok", "instagram"]);
    expect(payload.concept).toBeUndefined();
  });

  it("lym_create_letter_video declares a format select defaulting to hook-plus-letter", () => {
    const video = { manifest: manifestFixture("video-demo") };
    const letter = missionTypesForManifest(video.manifest).find((t) => t.type === "lym_create_letter_video");
    const field = letter?.fields?.find((f) => f.key === "format");
    expect(field).toMatchObject({ type: "select", required: true });
    expect(field && field.type === "select" ? field.options.map((o) => o.value) : []).toEqual([
      "hook-plus-letter",
      "letter-only",
    ]);
    expect(JSON.parse(letter!.payload).format).toBe("hook-plus-letter");
  });

  it("validateMissionPayload accepts both letter formats and refuses anything else", () => {
    const base = { missionTypes: typesOf("video-demo"), type: "lym_create_letter_video" };
    const platforms = ["tiktok", "instagram"];
    expect(validateMissionPayload({ ...base, payload: { platforms, format: "hook-plus-letter" } })).toBeNull();
    expect(validateMissionPayload({ ...base, payload: { platforms, format: "letter-only" } })).toBeNull();
    expect(validateMissionPayload({ ...base, payload: { platforms, format: "narrative" } })).not.toBeNull();
    expect(validateMissionPayload({ ...base, payload: { platforms } })).not.toBeNull();
  });

  it("leaves lym_create_letter_video platform validation to the raw JSON payload", () => {
    expect(
      validateMissionPayload({
        missionTypes: typesOf("video-demo"),
        type: "lym_create_letter_video",
        payload: { format: "hook-plus-letter" },
      }),
    ).toBeNull();
    expect(validateMissionPayload({ missionTypes: typesOf("seo"), type: "create_article", payload: { keyword: "" } })).toBeNull();
  });

  it("validateMissionPayload requires lym_create_marketing_video's category (declared via manifest fields, not a switch)", () => {
    expect(
      validateMissionPayload({
        missionTypes: typesOf("video-demo"),
        type: "lym_create_marketing_video",
        payload: { platforms: ["tiktok", "instagram"], category: "apology", occasion: "" },
      }),
    ).toBeNull();
    expect(
      validateMissionPayload({
        missionTypes: typesOf("video-demo"),
        type: "lym_create_marketing_video",
        payload: { platforms: ["tiktok", "instagram"], category: "", occasion: "" },
      }),
    ).not.toBeNull();
    expect(
      validateMissionPayload({
        missionTypes: typesOf("video-demo"),
        type: "lym_create_marketing_video",
        payload: {},
      }),
    ).not.toBeNull();
  });

  it("validateMissionPayload returns null for an unknown type (no schema to check against)", () => {
    expect(validateMissionPayload({ missionTypes: [], type: "whatever", payload: {} })).toBeNull();
  });

  it("validateMissionPayload requires create_chat_mock_video's typed transcriptRequest fields, including turnCount bounds (issue #336)", () => {
    const validPayload = {
      platforms: ["tiktok", "instagram"],
      theme: "hurt",
      personaDescriptionA: "feels unheard after a long week",
      personaDescriptionB: "feels blamed for something out of their control",
      avatarLabelA: "Sam",
      avatarLabelB: "Jo",
      turnCount: 5,
      language: "en",
    };
    expect(
      validateMissionPayload({ missionTypes: typesOf("video-demo"), type: "create_chat_mock_video", payload: validPayload }),
    ).toBeNull();
    expect(
      validateMissionPayload({
        missionTypes: typesOf("video-demo"),
        type: "create_chat_mock_video",
        payload: { ...validPayload, theme: "not-a-real-theme" },
      }),
    ).not.toBeNull();
    expect(
      validateMissionPayload({
        missionTypes: typesOf("video-demo"),
        type: "create_chat_mock_video",
        payload: { ...validPayload, language: "de" },
      }),
    ).not.toBeNull();
    expect(
      validateMissionPayload({
        missionTypes: typesOf("video-demo"),
        type: "create_chat_mock_video",
        payload: { ...validPayload, turnCount: 2 },
      }),
    ).not.toBeNull();
    expect(
      validateMissionPayload({
        missionTypes: typesOf("video-demo"),
        type: "create_chat_mock_video",
        payload: { ...validPayload, turnCount: 9 },
      }),
    ).not.toBeNull();
    expect(
      validateMissionPayload({
        missionTypes: typesOf("video-demo"),
        type: "create_chat_mock_video",
        payload: { ...validPayload, turnCount: undefined },
      }),
    ).not.toBeNull();
    expect(
      validateMissionPayload({
        missionTypes: typesOf("video-demo"),
        type: "create_chat_mock_video",
        payload: {},
      }),
    ).not.toBeNull();
  });

  it("validateMissionPayloadUnlessRaw skips validation when rawMode is true (issue #300 escape hatch)", () => {
    expect(
      validateMissionPayloadUnlessRaw({
        missionTypes: typesOf("video-demo"),
        type: "lym_create_marketing_video",
        payload: {},
        rawMode: true,
      }),
    ).toBeNull();
    expect(
      validateMissionPayloadUnlessRaw({
        missionTypes: typesOf("video-demo"),
        type: "lym_create_marketing_video",
        payload: {},
        rawMode: false,
      }),
    ).not.toBeNull();
  });

  it("each manifest option carries a human label and valid-JSON payload", () => {
    const seo = { manifest: manifestFixture("seo") };
    const video = { manifest: manifestFixture("video-demo") };
    for (const manifest of [seo.manifest, video.manifest]) {
      for (const option of missionTypesForManifest(manifest)) {
        expect(option.label.length).toBeGreaterThan(0);
        expect(() => JSON.parse(option.payload)).not.toThrow();
      }
    }
  });

  it("returns an empty list for a manifest without missionTypes (form falls back to free text)", () => {
    const hello = { manifest: manifestFixture("hello") };
    expect(missionTypesForManifest(hello.manifest)).toEqual([]);
  });
});

describe("visibleMissionTypes", () => {
  const types = [
    { type: "lym_create_letter_video", label: "Create letter video", payload: "{}", agentsMd: "a.md" },
    { type: "lym_create_marketing_video", label: "Create marketing video", payload: "{}", agentsMd: "b.md" },
    { type: "create_chat_mock_video", label: "Create chat mock video", payload: "{}", agentsMd: "c.md" },
  ];

  it("shows every type when nothing is hidden", () => {
    expect(visibleMissionTypes(types, undefined)).toEqual(types);
    expect(visibleMissionTypes(types, [])).toEqual(types);
  });

  it("drops the hidden types and keeps the others in order", () => {
    const visible = visibleMissionTypes(types, ["create_chat_mock_video"]);
    expect(visible.map((t) => t.type)).toEqual(["lym_create_letter_video", "lym_create_marketing_video"]);
  });

  it("ignores hidden names the Template no longer declares", () => {
    expect(visibleMissionTypes(types, ["removed_type"])).toEqual(types);
  });

  it("keeps a type added to the Template later visible (deny-list, not allow-list)", () => {
    const withNew = [...types, { type: "new_brand_video", label: "New", payload: "{}", agentsMd: "d.md" }];
    const visible = visibleMissionTypes(withNew, ["create_chat_mock_video"]);
    expect(visible.map((t) => t.type)).toContain("new_brand_video");
  });
});
