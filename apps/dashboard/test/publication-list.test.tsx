/** @vitest-environment jsdom */

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PublicationList } from "../src/components/publication-list";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const useQueryMock = vi.fn();
const retryMock = vi.fn();
const resendMock = vi.fn();

vi.mock("convex/react", () => ({
  useQuery: (...args: unknown[]) => useQueryMock(...args),
  useAction: (ref: string) => (ref === "publication_notify_node.resendPublishedNotification" ? resendMock : retryMock),
}));
vi.mock("@convex/_generated/api", () => ({
  api: {
    publications: { listForMission: "publications.listForMission" },
    publisher_node: { retryPublication: "publisher_node.retryPublication" },
    publication_notify_node: { resendPublishedNotification: "publication_notify_node.resendPublishedNotification" },
  },
}));

describe("PublicationList", () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    useQueryMock.mockReset();
    retryMock.mockReset();
    retryMock.mockResolvedValue({ ok: true });
    resendMock.mockReset();
    resendMock.mockResolvedValue({ ok: true });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  const rows = [
    { id: "p1", target: "instagram", status: "failed", error: "Postiz responded 500" },
    { id: "p2", target: "pinterest:recipes", status: "published", externalId: "post-9", externalUrl: "https://x.test/p/9" },
    { id: "p3", target: "tiktok", status: "scheduled", externalId: "post-3", scheduledAt: Date.UTC(2030, 0, 2, 3, 4) },
  ];

  it("shows status, external link or id, scheduled date and error, and retries only a failed one", async () => {
    useQueryMock.mockReturnValue(rows);
    await act(async () => root.render(<PublicationList missionId="m1" />));
    const q = (t: string) => container.querySelector(`[data-testid="publication-${t}"]`)!;
    const e = (t: string) => container.querySelector(`[data-testid="publication-error-${t}"]`)!;
    expect(q("instagram").textContent).toContain("Failed");
    expect(q("instagram").textContent).not.toContain("Postiz responded 500");
    expect(e("instagram").textContent).toContain("Postiz responded 500");
    expect(q("pinterest:recipes").querySelector("a")?.getAttribute("href")).toBe("https://x.test/p/9");
    expect(q("tiktok").textContent).toContain("post-3");
    expect(q("tiktok").textContent).toContain("2030");
    expect(container.querySelectorAll("button")).toHaveLength(1);

    await act(async () => {
      (e("instagram").querySelector("button") as HTMLButtonElement).click();
    });
    expect(retryMock).toHaveBeenCalledWith({ publicationId: "p1" });
  });

  it("shows submitting and uncertain clearly, and allows Retry only on uncertain (and failed)", async () => {
    useQueryMock.mockReturnValue([
      { id: "p1", target: "instagram", status: "submitting" },
      { id: "p2", target: "tiktok", status: "uncertain", error: "Postiz may have received this post; it will be checked before any new attempt (x)" },
    ]);
    await act(async () => root.render(<PublicationList missionId="m1" />));
    const q = (t: string) => container.querySelector(`[data-testid="publication-${t}"]`)!;
    const e = (t: string) => container.querySelector(`[data-testid="publication-error-${t}"]`)!;
    expect(q("instagram").textContent).toContain("Sending");
    expect(q("instagram").querySelector("button")).toBeNull();
    expect(q("tiktok").textContent).toContain("Uncertain");
    expect(e("tiktok").textContent).toContain("Postiz may have received this post");
    await act(async () => {
      (e("tiktok").querySelector("button") as HTMLButtonElement).click();
    });
    expect(retryMock).toHaveBeenCalledWith({ publicationId: "p2" });
  });

  it("shows the retry error and renders nothing without Publications", async () => {
    useQueryMock.mockReturnValue(rows);
    retryMock.mockRejectedValue(new Error("Postiz responded 502"));
    await act(async () => root.render(<PublicationList missionId="m1" />));
    await act(async () => {
      (container.querySelector("button") as HTMLButtonElement).click();
    });
    expect(container.textContent).toContain("Postiz responded 502");
    useQueryMock.mockReturnValue([]);
    await act(async () => root.render(<PublicationList missionId="m1" />));
    expect(container.innerHTML).toBe("");
  });

  it("links to the post in the Publisher's own UI", async () => {
    useQueryMock.mockReturnValue([
      { id: "p1", target: "instagram", status: "published", externalId: "abc", managerUrl: "https://postiz.example.com/p/abc", managerName: "Postiz" },
    ]);
    await act(async () => root.render(<PublicationList missionId="m1" />));
    const link = container.querySelector('[data-testid="publication-instagram"] a');
    expect(link?.getAttribute("href")).toBe("https://postiz.example.com/p/abc");
    expect(link?.textContent).toBe("Open in Postiz");
  });

  it("warns that the producing service was not notified, and resends the call (ADR-074)", async () => {
    useQueryMock.mockReturnValue([
      { id: "p1", target: "github:acme/site", status: "published", notification: { status: "failed", service: "seo-mcp", error: "Notifying seo-mcp failed: 503" } },
      { id: "p2", target: "instagram", status: "published", notification: { status: "sent", service: "seo-mcp" } },
    ]);
    await act(async () => root.render(<PublicationList missionId="m1" />));
    const warning = container.querySelector('[data-testid="publication-notification-github:acme/site"]')!;
    expect(warning.textContent).toContain("seo-mcp was not notified");
    expect(warning.textContent).toContain("503");
    expect(container.querySelector('[data-testid="publication-notification-instagram"]')).toBeNull();
    expect(container.querySelector('[data-testid="publication-errors"]')).toBeNull();

    await act(async () => {
      (warning.querySelector("button") as HTMLButtonElement).click();
    });
    expect(resendMock).toHaveBeenCalledWith({ publicationId: "p1" });
    expect(retryMock).not.toHaveBeenCalled();
  });
});
