import { beforeEach, describe, expect, it, vi } from "vitest";

const createAuthClientMock = vi.fn((options: { baseURL?: string }) => ({
  options,
  signOut: vi.fn(),
  useSession: vi.fn()
}));

vi.mock("better-auth/react", () => ({
  createAuthClient: (options: { baseURL?: string }) => createAuthClientMock(options)
}));
vi.mock("@convex-dev/better-auth/client/plugins", () => ({ convexClient: () => ({}) }));

describe("auth client", () => {
  beforeEach(() => {
    vi.resetModules();
    createAuthClientMock.mockClear();
  });

  it("is built from the runtime app URL, not a build-time constant", async () => {
    const { initAuthClient, getAuthClient } = await import("../src/lib/auth-client");
    initAuthClient("https://app.example");
    expect((getAuthClient() as unknown as { options: { baseURL: string } }).options.baseURL).toBe(
      "https://app.example"
    );
  });

  it("rebuilds the client only when the URL changes", async () => {
    const { initAuthClient } = await import("../src/lib/auth-client");
    const first = initAuthClient("https://a.example");
    expect(initAuthClient("https://a.example")).toBe(first);
    expect(initAuthClient("https://b.example")).not.toBe(first);
    expect(createAuthClientMock).toHaveBeenCalledTimes(2);
  });

  it("refuses to be used before it is initialised", async () => {
    const { getAuthClient } = await import("../src/lib/auth-client");
    expect(() => getAuthClient()).toThrow(/ConvexClientProvider/);
  });
});
