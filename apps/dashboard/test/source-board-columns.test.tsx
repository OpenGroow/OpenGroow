/** @vitest-environment jsdom */

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Id } from "@convex/_generated/dataModel";
import { UpstreamColumns, type BoardSource } from "../src/components/source-board-columns";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { children?: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

const idea: BoardSource = {
  _id: "s-idea" as Id<"sources">, routing: undefined, label: "TikTok post", family: "social", origin: "https://example.com/a",
  summary: "A strong hook", score: 0.82, capturedAt: 1,
};
const proposed: BoardSource = {
  _id: "s-route" as Id<"sources">, label: "TikTok post", family: "social", origin: "https://example.com/b", summary: "Another hook", score: 0.7, capturedAt: 2,
  routing: {
    state: "proposed", decidedBy: "agent", templateId: "@x/video", agentName: "video", missionType: "create_reel", label: "Create reel",
    payload: { publish: { title: "My title" }, observationId: "s-route" }, rationale: "Fits a reel", candidates: [], proposedAt: 2,
  },
};

describe("UpstreamColumns (ADR-076)", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  async function render(props: Partial<React.ComponentProps<typeof UpstreamColumns>> = {}) {
    const handlers = { onProduce: vi.fn(async () => {}), onApprove: vi.fn(async () => {}), onReject: vi.fn(async () => {}) };
    await act(async () => {
      root.render(<UpstreamColumns projectId="proj-1" query="" ideas={[idea]} toRoute={[proposed]} reviewRouting {...handlers} {...props} />);
    });
    return handlers;
  }

  const click = async (scope: Element, name: string) => {
    const button = Array.from(scope.querySelectorAll("button")).find((b) => b.textContent?.includes(name) || b.getAttribute("aria-label") === name)!;
    await act(async () => { button.click(); });
  };

  it("shows ideas and routing proposals, and their actions call back", async () => {
    const { onProduce, onApprove, onReject } = await render();
    const ideas = document.body.querySelector("[data-column='ideas']")!;
    const toRoute = document.body.querySelector("[data-column='to_route']")!;
    expect(ideas.textContent).toContain("A strong hook");
    expect(toRoute.textContent).toContain("Create Reel");
    expect(toRoute.textContent).toContain("Fits a reel");
    expect(toRoute.textContent).toContain("My title");

    await click(ideas, "Produce");
    await click(toRoute, "Approve");
    await click(toRoute, "Reject");
    expect(onProduce).toHaveBeenCalledWith("s-idea");
    expect(onApprove).toHaveBeenCalledWith("s-route");
    expect(onReject).toHaveBeenCalledWith("s-route");
  });

  it("filters both columns with the search text", async () => {
    await render({ query: "another" });
    expect(document.body.querySelector("[data-column='ideas']")!.textContent).not.toContain("A strong hook");
    expect(document.body.querySelector("[data-column='to_route']")!.textContent).toContain("Another hook");
  });

  it("tells how to turn on review when routing runs unattended", async () => {
    await render({ toRoute: [], reviewRouting: false });
    expect(document.body.querySelector("[data-column='to_route']")!.textContent).toContain("Routing runs unattended");
  });
});
