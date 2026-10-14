import { afterEach, describe, expect, it, vi } from "vitest";

const redirectMock = vi.fn((url: string) => {
  throw new Error(`NEXT_REDIRECT:${url}`);
});
const isAuthenticatedMock = vi.fn();

vi.mock("next/navigation", () => ({ redirect: (url: string) => redirectMock(url) }));
vi.mock("@/src/lib/auth-server", () => ({ isAuthenticated: () => isAuthenticatedMock() }));

import AppLayout from "../app/(app)/layout";

describe("(app) layout", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("sends an unauthenticated visitor to the dashboard's own /sign-in", async () => {
    isAuthenticatedMock.mockResolvedValue(false);
    await expect(AppLayout({ children: null })).rejects.toThrow("NEXT_REDIRECT:/sign-in");
  });

  it("ignores a legacy NEXT_PUBLIC_LANDING_URL", async () => {
    vi.stubEnv("NEXT_PUBLIC_LANDING_URL", "https://landing.example.com");
    isAuthenticatedMock.mockResolvedValue(false);
    await expect(AppLayout({ children: null })).rejects.toThrow("NEXT_REDIRECT:/sign-in");
  });
});
