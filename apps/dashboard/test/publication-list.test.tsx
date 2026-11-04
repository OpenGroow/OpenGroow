/** @vitest-environment jsdom */

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PublicationList } from "../src/components/publication-list";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const useQueryMock = vi.fn();
const retryMock = vi.fn();

vi.mock("convex/react", () => ({
  useQuery: (...args: unknown[]) => useQueryMock(...args),
  useAction: () => retryMock,
}));
vi.mock("@convex/_generated/api", () => ({
  api: {
    publications: { listForMission: "publications.listForMission" },
    publisher_node: { retryPublication: "publisher_node.retryPublication" },
  },
}));

describe("PublicationList", () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    useQueryMock.mockReset();
    retryMock.mockReset();
    retryMock.mockResolvedValue({ ok: true });
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
    expect(q("instagram").textContent).toContain("failed");
    expect(q("instagram").textContent).toContain("Postiz responded 500");
    expect(q("pinterest:recipes").querySelector("a")?.getAttribute("href")).toBe("https://x.test/p/9");
    expect(q("tiktok").textContent).toContain("post-3");
    expect(q("tiktok").textContent).toContain("2030");
    expect(container.querySelectorAll("button")).toHaveLength(1);

    await act(async () => {
      (q("instagram").querySelector("button") as HTMLButtonElement).click();
    });
    expect(retryMock).toHaveBeenCalledWith({ publicationId: "p1" });
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
});
