import { describe, it, expect, vi, afterEach } from "vitest";
import { interpolateActivationBody, extractResponseId, deriveConfigIdKey, OMIT, type RefContext } from "./activation-engine.js";
import { executeActivationEffect } from "./execute-activation-effect.js";
import type { ActivationEffect } from "./types.js";

const BASE_CTX: RefContext = {
  userConfig: { domain: "example.com", language: "en", apiKey: "key-1" },
  config: {},
};

describe("interpolateActivationBody", () => {
  describe("string leaves", () => {
    it("resolves a bare {ref} to its userConfig value", () => {
      const result = interpolateActivationBody("{domain}", BASE_CTX, false);
      expect(result).toBe("example.com");
    });

    it("returns OMIT for a bare {ref} that resolves to undefined", () => {
      const result = interpolateActivationBody("{unknown}", BASE_CTX, false);
      expect(result).toBe(OMIT);
    });

    it("returns OMIT for a bare {ref} that resolves to empty string", () => {
      const ctx: RefContext = { userConfig: { domain: "" }, config: {} };
      const result = interpolateActivationBody("{domain}", ctx, false);
      expect(result).toBe(OMIT);
    });

    it("keeps literal strings unchanged", () => {
      const result = interpolateActivationBody("github", BASE_CTX, false);
      expect(result).toBe("github");
    });

    it("interpolates a partial string (literal + ref) when the ref resolves", () => {
      const result = interpolateActivationBody("https://{domain}/feed", BASE_CTX, false);
      expect(result).toBe("https://example.com/feed");
    });

    it("OMITs the whole partial string when an embedded ref resolves empty (no dangling prefix)", () => {
      const ctx: RefContext = { userConfig: { domain: "" }, config: {} };
      const result = interpolateActivationBody("https://{domain}/feed", ctx, false);
      expect(result).toBe(OMIT);
    });

    it("resolves a {config.key} reference to existingConfig", () => {
      const ctx: RefContext = {
        userConfig: {},
        config: { seoProjectId: "proj-123" },
      };
      const result = interpolateActivationBody("{config.seoProjectId}", ctx, false);
      expect(result).toBe("proj-123");
    });

    it("returns OMIT for a {config.key} that is absent", () => {
      const ctx: RefContext = { userConfig: {}, config: {} };
      const result = interpolateActivationBody("{config.seoProjectId}", ctx, false);
      expect(result).toBe(OMIT);
    });
  });

  describe("object nodes", () => {
    it("includes keys with resolved values", () => {
      const body = { domain: "{domain}", lang: "{language}" };
      const result = interpolateActivationBody(body, BASE_CTX, false);
      expect(result).toEqual({ domain: "example.com", lang: "en" });
    });

    it("omits keys where the interpolated string resolves to OMIT (POST)", () => {
      const body = { domain: "{domain}", branch: "{githubBranch}" };
      const result = interpolateActivationBody(body, BASE_CTX, false);
      expect(result).toEqual({ domain: "example.com" });
    });

    it("omits an object (POST) when all interpolated leaves are OMIT, even when literal siblings remain", () => {
      // ADR-021: literals are "passengers" — they should not prevent omission when
      // every user-configurable (interpolated) field is absent.
      // publisher: { type: "github", owner: "{githubOwner}" } — githubOwner absent.
      const body = { type: "github", owner: "{githubOwner}" };
      const ctx: RefContext = { userConfig: {}, config: {} };
      // githubOwner absent → all interpolated leaves OMIT → whole object OMIT.
      const result = interpolateActivationBody(body, ctx, false);
      expect(result).toBe(OMIT);
    });

    it("omits the indexer object (POST) when indexerApiKey is absent, even with literal type field", () => {
      // indexer: { type: "speedyindex", apiKey: "{indexerApiKey}" }
      // indexerApiKey absent → all interpolated leaves OMIT → object OMIT.
      const body = { type: "speedyindex", apiKey: "{indexerApiKey}" };
      const ctx: RefContext = { userConfig: {}, config: {} };
      const result = interpolateActivationBody(body, ctx, false);
      expect(result).toBe(OMIT);
    });

    it("returns null (PATCH) instead of OMIT when all interpolated leaves are OMIT", () => {
      // An object with only interpolated empty leaves should return null on PATCH.
      const body = { token: "{letterToken}" };
      const ctx: RefContext = { userConfig: {}, config: {} };
      const result = interpolateActivationBody(body, ctx, true);
      // letterToken absent → OMIT → object returns null on PATCH
      expect(result).toBeNull();
    });

    it("includes nested objects recursively", () => {
      const body = {
        credentials: {
          letter: {
            baseUrl: "{letterBaseUrl}",
            token: "{letterToken}",
          },
        },
      };
      const ctx: RefContext = {
        userConfig: { letterBaseUrl: "https://letter.example.com", letterToken: "lt-secret" },
        config: {},
      };
      const result = interpolateActivationBody(body, ctx, false);
      expect(result).toEqual({
        credentials: {
          letter: { baseUrl: "https://letter.example.com", token: "lt-secret" },
        },
      });
    });

    it("omits optional nested token when not provided", () => {
      const body = {
        letter: {
          baseUrl: "{letterBaseUrl}",
          token: "{letterToken}",
        },
      };
      const ctx: RefContext = {
        userConfig: { letterBaseUrl: "https://letter.example.com" },
        config: {},
      };
      const result = interpolateActivationBody(body, ctx, false);
      expect(result).toEqual({ letter: { baseUrl: "https://letter.example.com" } });
    });

    it("passes non-string primitives through unchanged", () => {
      const body = { flag: true, count: 42, none: null };
      const result = interpolateActivationBody(body as never, BASE_CTX, false);
      expect(result).toEqual({ flag: true, count: 42, none: null });
    });
  });

  describe("SEO activation body simulation", () => {
    it("builds the full SEO POST body with all fields", () => {
      const body = {
        name: "{domain}",
        domain: "{domain}",
        language: "{language}",
        country: "{country}",
        context: "{context}",
        articleBasePath: "{articleBasePath}",
        publisher: {
          type: "github",
          owner: "{githubOwner}",
          repo: "{githubRepo}",
          contentBase: "{githubContentBase}",
          coverBase: "{githubCoverBase}",
          publicBase: "{githubPublicBase}",
          token: "{githubToken}",
          branch: "{githubBranch}",
        },
        config: {
          indexer: {
            type: "speedyindex",
            apiKey: "{indexerApiKey}",
          },
        },
      };
      const ctx: RefContext = {
        userConfig: {
          domain: "example.com",
          language: "en",
          country: "US",
          context: "SaaS product",
          articleBasePath: "/blog",
          githubOwner: "my-org",
          githubRepo: "my-site",
          githubContentBase: "content/blog",
          githubCoverBase: "public/covers",
          githubPublicBase: "public",
          githubToken: "ghp_secret",
          githubBranch: "main",
          indexerApiKey: "spdy-key",
        },
        config: {},
      };
      const result = interpolateActivationBody(body, ctx, false) as Record<string, unknown>;
      expect(result).toMatchObject({
        name: "example.com",
        domain: "example.com",
        language: "en",
        country: "US",
        context: "SaaS product",
        articleBasePath: "/blog",
        publisher: {
          type: "github",
          owner: "my-org",
          repo: "my-site",
          branch: "main",
        },
        config: { indexer: { type: "speedyindex", apiKey: "spdy-key" } },
      });
    });

    it("omits optional fields (context, articleBasePath, branch, indexer) when absent", () => {
      const body = {
        name: "{domain}",
        domain: "{domain}",
        language: "{language}",
        country: "{country}",
        context: "{context}",
        articleBasePath: "{articleBasePath}",
        publisher: {
          type: "github",
          owner: "{githubOwner}",
          repo: "{githubRepo}",
          contentBase: "{githubContentBase}",
          coverBase: "{githubCoverBase}",
          publicBase: "{githubPublicBase}",
          token: "{githubToken}",
          branch: "{githubBranch}",
        },
        config: {
          indexer: {
            type: "speedyindex",
            apiKey: "{indexerApiKey}",
          },
        },
      };
      const ctx: RefContext = {
        userConfig: {
          domain: "example.com",
          language: "en",
          country: "US",
          githubOwner: "my-org",
          githubRepo: "my-site",
          githubContentBase: "content/blog",
          githubCoverBase: "public/covers",
          githubPublicBase: "public",
          githubToken: "ghp_secret",
        },
        config: {},
      };
      const result = interpolateActivationBody(body, ctx, false) as Record<string, unknown>;
      expect(result).not.toHaveProperty("context");
      expect(result).not.toHaveProperty("articleBasePath");
      expect(result.publisher).not.toHaveProperty("branch");
      // indexer: only literal "speedyindex" type remains — no apiKey ref resolved
      // The object keeps type but omits apiKey
      const config = result.config as Record<string, unknown> | undefined;
      if (config) {
        const indexer = config.indexer as Record<string, unknown> | undefined;
        if (indexer) {
          expect(indexer).not.toHaveProperty("apiKey");
          expect(indexer.type).toBe("speedyindex");
        }
      }
    });
  });
});

describe("interpolateActivationBody — {responseId} reference", () => {
  it("resolves {responseId} from ctx.responseId", () => {
    const ctx: RefContext = { userConfig: {}, config: {}, responseId: "proj-abc" };
    const result = interpolateActivationBody("{responseId}", ctx, false);
    expect(result).toBe("proj-abc");
  });

  it("returns OMIT for {responseId} when ctx.responseId is absent", () => {
    const ctx: RefContext = { userConfig: {}, config: {} };
    const result = interpolateActivationBody("{responseId}", ctx, false);
    expect(result).toBe(OMIT);
  });

  it("places {responseId} under its key in an object", () => {
    const ctx: RefContext = { userConfig: { domain: "example.com" }, config: {}, responseId: "proj-abc" };
    const body = { seoProjectId: "{responseId}", domain: "{domain}" };
    const result = interpolateActivationBody(body, ctx, false) as Record<string, unknown>;
    expect(result.seoProjectId).toBe("proj-abc");
    expect(result.domain).toBe("example.com");
  });
});

describe("deriveConfigIdKey", () => {
  it("returns the key holding {responseId} at the top level", () => {
    expect(deriveConfigIdKey({ seoProjectId: "{responseId}", domain: "{domain}" })).toBe("seoProjectId");
  });

  it("returns the key holding {responseId} for video (top-level)", () => {
    expect(deriveConfigIdKey({ videoProjectId: "{responseId}", name: "{siteBaseUrl}" })).toBe("videoProjectId");
  });

  it("returns undefined when no {responseId} leaf exists", () => {
    expect(deriveConfigIdKey({ context: "{context}" })).toBeUndefined();
  });

  it("returns undefined for undefined body", () => {
    expect(deriveConfigIdKey(undefined)).toBeUndefined();
  });

  it("returns undefined for a non-object body", () => {
    expect(deriveConfigIdKey("not-an-object")).toBeUndefined();
  });
});

describe("extractResponseId", () => {
  it("extracts a top-level field", () => {
    expect(extractResponseId({ seoProjectId: "proj-123" }, "seoProjectId")).toBe("proj-123");
  });

  it("extracts a nested field via dotted path", () => {
    expect(extractResponseId({ project: { id: "vid-abc" } }, "project.id")).toBe("vid-abc");
  });

  it("throws when the path does not resolve to a string", () => {
    expect(() => extractResponseId({ project: { id: 42 } }, "project.id")).toThrow(/project\.id/);
  });

  it("throws when intermediate path is not an object", () => {
    expect(() => extractResponseId({ project: "not-an-object" }, "project.id")).toThrow();
  });

  it("throws when the field is missing", () => {
    expect(() => extractResponseId({}, "seoProjectId")).toThrow(/seoProjectId/);
  });
});

describe("executeActivationEffect", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const SEO_EFFECT: ActivationEffect = {
    server: "article-mcp",
    method: "POST",
    path: "/projects",
    responseIdField: "seoProjectId",
    treatConflictAsExisting: true,
    body: {
      seoProjectId: "{responseId}",
      name: "{domain}",
      domain: "{domain}",
      language: "{language}",
      country: "{country}",
    },
  };

  it("POSTs with correct URL, auth header, and body", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({ seoProjectId: "proj-abc" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await executeActivationEffect(SEO_EFFECT, { domain: "example.com", language: "en", country: "US" }, {}, "https://seo.test", "key-1");

    expect(fetchMock).toHaveBeenCalledWith("https://seo.test/projects", expect.objectContaining({
      method: "POST",
      headers: expect.objectContaining({ Authorization: "Bearer key-1" }),
    }));
    const body = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body);
    expect(body).toMatchObject({ name: "example.com", domain: "example.com" });
  });

  it("returns flat config with configIdKey from response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({ seoProjectId: "proj-abc" }),
    }));

    const { config } = await executeActivationEffect(
      SEO_EFFECT,
      { domain: "example.com", language: "en", country: "US", apiKey: "key-1" },
      {},
      "https://seo.test",
      "key-1",
    );

    expect(config.seoProjectId).toBe("proj-abc");
    expect(config.domain).toBe("example.com");
    expect(config.apiKey).toBe("key-1");
  });

  it("accepts 409 when treatConflictAsExisting is true", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      statusText: "Conflict",
      json: async () => ({ seoProjectId: "proj-existing" }),
    }));

    const { config } = await executeActivationEffect(
      SEO_EFFECT,
      { domain: "example.com", language: "en", country: "US" },
      {},
      "https://seo.test",
      "key-1",
    );

    expect(config.seoProjectId).toBe("proj-existing");
  });

  it("throws on non-409 errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
      json: async () => ({}),
    }));

    await expect(
      executeActivationEffect(SEO_EFFECT, {}, {}, "https://seo.test", "key-1"),
    ).rejects.toThrow(/500/);
  });

  it("interpolates PATCH path with config values", async () => {
    const patchEffect: ActivationEffect = {
      server: "article-mcp",
      method: "PATCH",
      path: "/projects/{config.seoProjectId}",
      responseIdField: "seoProjectId",
      body: { context: "{context}" },
    };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ seoProjectId: "proj-frozen" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await executeActivationEffect(
      patchEffect,
      { context: "New context" },
      { seoProjectId: "proj-frozen", apiKey: "key-frozen" },
      "https://seo.test",
      "key-frozen",
    );

    expect(fetchMock).toHaveBeenCalledWith("https://seo.test/projects/proj-frozen", expect.anything());
  });

  it("video: reads project.id via dotted responseIdField", async () => {
    const videoEffect: ActivationEffect = {
      server: "video-mcp",
      method: "POST",
      path: "/projects",
      responseIdField: "project.id",
      treatConflictAsExisting: true,
      body: { videoProjectId: "{responseId}", name: "{siteBaseUrl}" },
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({ project: { id: "vid-proj-abc" } }),
    }));

    const { config } = await executeActivationEffect(
      videoEffect,
      { siteBaseUrl: "https://example.com", apiKey: "vid-key" },
      {},
      "https://video.test",
      "vid-key",
    );

    expect(config.videoProjectId).toBe("vid-proj-abc");
  });

  it("PATCH with an empty response body falls back to the frozen id in existing config", async () => {
    const patchEffect: ActivationEffect = {
      server: "article-mcp",
      method: "PATCH",
      path: "/projects/{config.seoProjectId}",
      responseIdField: "seoProjectId",
      body: { seoProjectId: "{responseId}", context: "{context}" },
    };
    // Simulate a 204-style empty body: response.json() rejects.
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      status: 204,
      json: async () => {
        throw new SyntaxError("Unexpected end of JSON input");
      },
    }));

    const { config } = await executeActivationEffect(
      patchEffect,
      { context: "New context" },
      { seoProjectId: "proj-frozen", apiKey: "key-frozen" },
      "https://seo.test",
      "key-frozen",
    );

    expect(config.seoProjectId).toBe("proj-frozen");
    expect(config.context).toBe("New context");
  });
});

// #670: activation bodies only resolve the Agent's own submitted fields and stored config.
describe("activation interpolation scope", () => {
  it.each(["{constructor}", "{__proto__}", "{toString}", "{config.constructor}", "{config.__proto__}"])(
    "never resolves an inherited property: %s",
    (ref) => {
      expect(interpolateActivationBody(ref, { userConfig: {}, config: {} }, false)).toBe(OMIT);
    },
  );

  it("resolves only the two Agent-owned scopes: no environment or other Agent reference", () => {
    const ctx: RefContext = { userConfig: { domain: "a.com" }, config: { id: "42" } };
    expect(interpolateActivationBody({ d: "{domain}", i: "{config.id}", e: "{env.SECRET}", o: "{agents.x.apiKey}" }, ctx, false)).toEqual({
      d: "a.com",
      i: "42",
    });
  });
});
