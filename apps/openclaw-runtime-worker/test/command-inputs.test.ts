import { describe, expect, it } from "vitest";
import {
  extractPendingDeviceRequestIds,
  readAuthKind,
  readAuthModel,
  readEnabled,
} from "../src/commands/command-inputs.js";

describe("readEnabled", () => {
  it("reads an explicit boolean", () => {
    expect(readEnabled({ enabled: false })).toBe(false);
    expect(readEnabled({ enabled: true })).toBe(true);
  });

  it("returns undefined when absent or not a boolean", () => {
    expect(readEnabled({})).toBeUndefined();
    expect(readEnabled({ enabled: "false" })).toBeUndefined();
    expect(readEnabled(undefined)).toBeUndefined();
  });
});

describe("readAuthKind", () => {
  it("accepts 'apikey' and 'subscription'", () => {
    expect(readAuthKind({ kind: "apikey" })).toBe("apikey");
    expect(readAuthKind({ kind: "subscription" })).toBe("subscription");
  });

  it("rejects any other value", () => {
    expect(readAuthKind({ kind: "oauth" })).toBe("");
    expect(readAuthKind({})).toBe("");
    expect(readAuthKind(undefined)).toBe("");
  });
});

describe("readAuthModel", () => {
  it("trims a string model", () => {
    expect(readAuthModel({ model: "  openai/gpt-5.5  " })).toBe("openai/gpt-5.5");
  });

  it("returns empty string when missing or not a string", () => {
    expect(readAuthModel({})).toBe("");
    expect(readAuthModel({ model: 5 })).toBe("");
    expect(readAuthModel(undefined)).toBe("");
  });
});

describe("extractPendingDeviceRequestIds", () => {
  it("reads request ids from the legacy pending array format", () => {
    expect(
      extractPendingDeviceRequestIds(
        JSON.stringify({
          pending: [{ requestId: "11111111-1111-1111-1111-111111111111" }],
        }),
      ),
    ).toEqual(["11111111-1111-1111-1111-111111111111"]);
  });

  it("reads request ids from the current object map format", () => {
    expect(
      extractPendingDeviceRequestIds(
        JSON.stringify({
          "60e988f5-0bfc-4dd3-883b-8cb35472af89": {
            requestId: "60e988f5-0bfc-4dd3-883b-8cb35472af89",
            displayName: "My Computer",
          },
          "27718b18-d029-4ad5-8fce-0a2e0d8619dc": {
            requestId: "27718b18-d029-4ad5-8fce-0a2e0d8619dc",
            displayName: "My Computer",
          },
        }),
      ),
    ).toEqual([
      "60e988f5-0bfc-4dd3-883b-8cb35472af89",
      "27718b18-d029-4ad5-8fce-0a2e0d8619dc",
    ]);
  });
});
