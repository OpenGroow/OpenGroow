import { afterEach, describe, expect, it, vi } from "vitest";
import { postizPlugin as postizAdapter } from "./postiz";

// Optional Publishable fields forwarded to Postiz (ADR-069 amendment): Postiz is
// stubbed at fetch; we observe the body of the `posts` call.

const CONN = { url: "https://postiz.example.com", apiKey: "k" };

function stub() {
  const calls: Array<{ path: string; body: any }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: unknown, init?: RequestInit) => {
      const path = String(url).split("/api/public/v1/")[1]!;
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ path, body });
      if (path === "upload-from-url") {
        return new Response(JSON.stringify({ id: `id-${calls.length}`, path: body.url }), { status: 200 });
      }
      return new Response(JSON.stringify([{ postId: "p1" }]), { status: 200 });
    }),
  );
  return calls;
}
const post = (calls: ReturnType<typeof stub>) => calls.find((c) => c.path === "posts")!.body.posts[0];

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Postiz adapter: optional Publishable fields", () => {
  it("forwards link to Pinterest", async () => {
    const calls = stub();
    const res = await postizAdapter.publish(CONN, {
      channelId: "c", channelService: "pinterest", settings: { board: "b" },
      publishable: { kind: "image", imageUrl: "https://x.test/i.png", caption: "c", link: "https://x.test/dest" },
    });
    expect(res.ok).toBe(true);
    expect(post(calls).settings).toMatchObject({ __type: "pinterest", board: "b", link: "https://x.test/dest" });
  });

  it("sends altText as alt on every image of an image or carousel, not on videos", async () => {
    let calls = stub();
    await postizAdapter.publish(CONN, {
      channelId: "c", channelService: "instagram",
      publishable: { kind: "carousel", slideUrls: ["https://x.test/1.png", "https://x.test/2.png"], caption: "c", altText: "A cat" },
    });
    expect(post(calls).value[0].image.map((i: any) => i.alt)).toEqual(["A cat", "A cat"]);

    calls = stub();
    await postizAdapter.publish(CONN, {
      channelId: "c", channelService: "instagram",
      publishable: { kind: "video", videoUrl: "https://x.test/v.mp4", caption: "c", altText: "A cat" },
    });
    expect(post(calls).value[0].image[0]).not.toHaveProperty("alt");
  });

  it("forwards tags and the cover as thumbnail to YouTube", async () => {
    const calls = stub();
    await postizAdapter.publish(CONN, {
      channelId: "c", channelService: "youtube",
      publishable: {
        kind: "video", videoUrl: "https://x.test/v.mp4", coverUrl: "https://x.test/c.png", title: "T", caption: "c", tags: ["a", "b"],
      },
    });
    expect(calls.filter((c) => c.path === "upload-from-url").map((c) => c.body.url)).toEqual([
      "https://x.test/v.mp4", "https://x.test/c.png",
    ]);
    expect(post(calls).value[0].image).toHaveLength(1);
    expect(post(calls).settings).toMatchObject({
      __type: "youtube", title: "T",
      tags: [{ value: "a", label: "a" }, { value: "b", label: "b" }],
      thumbnail: { path: "https://x.test/c.png" },
    });
  });

  it("silently ignores link, tags and cover where Postiz has no equivalent", async () => {
    const calls = stub();
    await postizAdapter.publish(CONN, {
      channelId: "c", channelService: "tiktok",
      publishable: {
        kind: "video", videoUrl: "https://x.test/v.mp4", coverUrl: "https://x.test/c.png", caption: "c", link: "https://x.test/d", tags: ["a"],
      },
    });
    expect(calls.filter((c) => c.path === "upload-from-url")).toHaveLength(1);
    const settings = post(calls).settings;
    expect(settings).not.toHaveProperty("link");
    expect(settings).not.toHaveProperty("tags");
    expect(settings).not.toHaveProperty("thumbnail");
  });
});

describe("Postiz adapter: connection URL", () => {
  it("requests exactly <host>/api/public/v1/... when the URL has trailing slashes", async () => {
    const urls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: unknown) => {
        urls.push(String(url));
        return new Response(JSON.stringify({ connected: true }), { status: 200 });
      }),
    );
    const res = await postizAdapter.testConnection({ url: "https://postiz.example.com//", apiKey: "k" });
    expect(res).toEqual({ ok: true });
    expect(urls).toEqual(["https://postiz.example.com/api/public/v1/is-connected"]);
  });
});

describe("Postiz adapter: media Postiz cannot fetch itself", () => {
  const publishVideo = (videoUrl: string) =>
    postizAdapter.publish(CONN, {
      channelId: "c", channelService: "instagram",
      publishable: { kind: "video", videoUrl, caption: "c" },
    });

  function stubBytes() {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: unknown, init?: RequestInit) => {
        const u = String(url);
        calls.push({ url: u, init });
        if (!u.includes("/api/public/v1/")) {
          return new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { "content-type": "video/mp4" } });
        }
        if (u.endsWith("/upload")) return new Response(JSON.stringify({ id: "up-1", path: "https://postiz.example.com/u/v.mp4" }), { status: 200 });
        return new Response(JSON.stringify([{ postId: "p1" }]), { status: 200 });
      }),
    );
    return calls;
  }

  it("downloads and sends the bytes when the URL is local, with the extension from the content type", async () => {
    const calls = stubBytes();
    const res = await publishVideo("http://localhost:4600/videos/run-1/final");
    expect(res.ok).toBe(true);
    expect(calls[0]!.url).toBe("http://localhost:4600/videos/run-1/final");
    const upload = calls.find((c) => c.url.endsWith("/upload"))!;
    expect(upload.init?.body).toBeInstanceOf(FormData);
    expect(((upload.init!.body as FormData).get("file") as File).name).toBe("final.mp4");
    expect(calls.some((c) => c.url.endsWith("/upload-from-url"))).toBe(false);
  });

  it("downloads a public HTTPS URL that has no supported extension", async () => {
    const calls = stubBytes();
    expect((await publishVideo("https://mcp.example.com/videos/run-1/final")).ok).toBe(true);
    expect(calls.some((c) => c.url.endsWith("/upload"))).toBe(true);
  });

  it("lets Postiz fetch a public HTTPS URL with an extension", async () => {
    const calls = stub();
    expect((await publishVideo("https://mcp.example.com/v/final.mp4")).ok).toBe(true);
    expect(calls.map((c) => c.path)).toEqual(["upload-from-url", "posts"]);
  });

  it("fails with a readable error when the local media cannot be downloaded", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 404 })));
    const res = await publishVideo("http://localhost:4600/videos/run-1/final");
    expect(res).toMatchObject({ ok: false });
    expect((res as { error: string }).error).toContain("it responded 404");
  });
});

describe("Postiz adapter: postUrl", () => {
  it("links to the Postiz preview page of the post", () => {
    expect(postizAdapter.postUrl?.({ url: "https://postiz.example.com/" }, "cmw57")).toBe("https://postiz.example.com/p/cmw57");
  });
});
