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
      publishable: { kind: "image", imageUrl: "https://x/i.png", caption: "c", link: "https://x/dest" },
    });
    expect(res.ok).toBe(true);
    expect(post(calls).settings).toMatchObject({ __type: "pinterest", board: "b", link: "https://x/dest" });
  });

  it("sends altText as alt on every image of an image or carousel, not on videos", async () => {
    let calls = stub();
    await postizAdapter.publish(CONN, {
      channelId: "c", channelService: "instagram",
      publishable: { kind: "carousel", slideUrls: ["https://x/1.png", "https://x/2.png"], caption: "c", altText: "A cat" },
    });
    expect(post(calls).value[0].image.map((i: any) => i.alt)).toEqual(["A cat", "A cat"]);

    calls = stub();
    await postizAdapter.publish(CONN, {
      channelId: "c", channelService: "instagram",
      publishable: { kind: "video", videoUrl: "https://x/v.mp4", caption: "c", altText: "A cat" },
    });
    expect(post(calls).value[0].image[0]).not.toHaveProperty("alt");
  });

  it("forwards tags and the cover as thumbnail to YouTube", async () => {
    const calls = stub();
    await postizAdapter.publish(CONN, {
      channelId: "c", channelService: "youtube",
      publishable: {
        kind: "video", videoUrl: "https://x/v.mp4", coverUrl: "https://x/c.png", title: "T", caption: "c", tags: ["a", "b"],
      },
    });
    expect(calls.filter((c) => c.path === "upload-from-url").map((c) => c.body.url)).toEqual([
      "https://x/v.mp4", "https://x/c.png",
    ]);
    expect(post(calls).value[0].image).toHaveLength(1);
    expect(post(calls).settings).toMatchObject({
      __type: "youtube", title: "T",
      tags: [{ value: "a", label: "a" }, { value: "b", label: "b" }],
      thumbnail: { path: "https://x/c.png" },
    });
  });

  it("silently ignores link, tags and cover where Postiz has no equivalent", async () => {
    const calls = stub();
    await postizAdapter.publish(CONN, {
      channelId: "c", channelService: "tiktok",
      publishable: {
        kind: "video", videoUrl: "https://x/v.mp4", coverUrl: "https://x/c.png", caption: "c", link: "https://x/d", tags: ["a"],
      },
    });
    expect(calls.filter((c) => c.path === "upload-from-url")).toHaveLength(1);
    const settings = post(calls).settings;
    expect(settings).not.toHaveProperty("link");
    expect(settings).not.toHaveProperty("tags");
    expect(settings).not.toHaveProperty("thumbnail");
  });
});
