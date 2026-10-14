import { describe, expect, it } from "vitest";
import { interpolateReviewTemplate } from "./review-interpolation";

const inputs = { externalId: "job 1", userInput: { note: "a/b?c" }, missionPayload: { platform: ["tiktok"], topic: "x y" } };
const interpolate = (template: string, encode: boolean) =>
  interpolateReviewTemplate(template, inputs.externalId, inputs.userInput, encode, inputs.missionPayload);

describe("review effect interpolation", () => {
  it("resolves {id}, {input.<key>} and {payload.<key>}, percent-encoding in a path", () => {
    expect(interpolate("/jobs/{id}/{input.note}/{payload.topic}", true)).toBe("/jobs/job%201/a%2Fb%3Fc/x%20y");
  });

  it("keeps a bare payload reference's JSON value in a body", () => {
    expect(interpolate("{payload.platform}", false)).toEqual(["tiktok"]);
  });

  it.each(["{payload.constructor}", "{payload.__proto__}", "{input.constructor}", "{input.__proto__}"])(
    "never resolves an inherited property: %s",
    (template) => {
      expect(interpolate(template, false)).toBe("");
      expect(interpolate(template, true)).toBe("");
    },
  );

  it("leaves a reference outside the grammar unresolved (no environment, no other Agent)", () => {
    expect(interpolate("{env.CONVEX_SECRET}{agents.other.config.apiKey}", false)).toBe("{env.CONVEX_SECRET}{agents.other.config.apiKey}");
  });
});
