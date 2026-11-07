import { describe, expect, it } from "vitest";
import { PUBLISHER_CONTRACT_VERSION, parsePublisherManifest, renderPostUrl } from "./manifest";

const valid = { id: "postiz", name: "Postiz", contractVersion: PUBLISHER_CONTRACT_VERSION, postUrl: "{url}/p/{id}" };

describe("parsePublisherManifest", () => {
  it("accepts a valid manifest, with or without postUrl", () => {
    expect(parsePublisherManifest(valid)).toEqual({ ok: true, manifest: valid });
    const { postUrl: _omit, ...bare } = valid;
    expect(parsePublisherManifest(bare)).toEqual({ ok: true, manifest: bare });
  });

  it("refuses a package built for another contract version, naming both", () => {
    const res = parsePublisherManifest({ ...valid, contractVersion: PUBLISHER_CONTRACT_VERSION + 1 });
    expect(res.ok).toBe(false);
    expect((res as { error: string }).error).toContain(`contract ${PUBLISHER_CONTRACT_VERSION + 1}`);
    expect((res as { error: string }).error).toContain(`supports contract ${PUBLISHER_CONTRACT_VERSION}`);
  });

  it.each([
    [null],
    [[]],
    [{ ...valid, id: "Not Valid" }],
    [{ ...valid, id: undefined }],
    [{ ...valid, name: "  " }],
    [{ ...valid, contractVersion: "1" }],
    [{ ...valid, contractVersion: 1.5 }],
    [{ ...valid, postUrl: "/p/{id}" }],
    [{ ...valid, postUrl: "{url}/p/{slug}" }],
    [{ ...valid, postUrl: 3 }],
  ])("refuses a malformed manifest %#", (raw) => {
    expect(parsePublisherManifest(raw).ok).toBe(false);
  });
});

describe("renderPostUrl", () => {
  it("strips trailing slashes from the connection URL and encodes the id", () => {
    expect(renderPostUrl("{url}/p/{id}", { url: "https://postiz.example.com//" }, "a b/c")).toBe("https://postiz.example.com/p/a%20b%2Fc");
  });
});
