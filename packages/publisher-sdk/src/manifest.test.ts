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
    [{ ...valid, postUrl: "{url}/posts" }],
    [{ ...valid, postUrl: "{url}/p/{id" }],
    [{ ...valid, postUrl: "{url}/p/}{id}" }],
    [{ ...valid, postUrl: "https://app.example.com/{url}/{id}" }],
  ])("refuses a malformed manifest %#", (raw) => {
    expect(parsePublisherManifest(raw).ok).toBe(false);
  });
});

describe("renderPostUrl", () => {
  it("strips trailing slashes from the connection URL and encodes the id", () => {
    expect(renderPostUrl("{url}/p/{id}", { url: "https://postiz.example.com//" }, "a b/c")).toBe("https://postiz.example.com/p/a%20b%2Fc");
  });

  it("inserts the connection URL verbatim: no placeholder or replacement pattern inside it is expanded", () => {
    expect(renderPostUrl("{url}/p/{id}", { url: "https://host/{id}/a$&b$$" }, "42")).toBe("https://host/{id}/a$&b$$/p/42");
  });

  it("accepts an absolute template that does not use the connection URL", () => {
    expect(renderPostUrl("https://app.example.com/p/{id}", { url: "https://ignored" }, "42")).toBe("https://app.example.com/p/42");
  });
});
