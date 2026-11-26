/** @vitest-environment jsdom */

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TraceListPage } from "../src/components/trace/trace-list-page";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const useQueryMock = vi.fn();

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));
vi.mock("convex/react", () => ({ useQuery: (...args: unknown[]) => useQueryMock(...args) }));
vi.mock("@convex/_generated/api", () => ({
  api: { run_trace_list: { listRecent: "listRecent", filterOptions: "filterOptions" } },
}));
vi.mock("@/src/components/dashboard-root-sidebar", () => ({ DashboardRootSidebar: () => null }));

const base = {
  instanceId: "project-1",
  projectName: "Example Project",
  templateId: "article-writer",
  agentName: "article-writer",
  status: "completed",
  createdAt: 1_900_000_000_000,
  completedAt: 1_900_000_065_000,
};
const items = [
  { ...base, runId: "run-m", kind: "mission", missionId: "mission-1", name: "create_article" },
  { ...base, runId: "run-j", kind: "job", missionId: null, name: "source_scoring" },
  { ...base, runId: "run-p", kind: "mission", missionId: "mission-2", name: "create_article", status: "pending", completedAt: null },
];

describe("TraceListPage", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    useQueryMock.mockReset();
    useQueryMock.mockImplementation((fn: string) =>
      fn === "listRecent"
        ? { items, nextCursor: null }
        : {
            projects: [{ instanceId: "project-1", name: "Example Project" }],
            agents: [{ templateId: "article-writer", name: "Article Writer" }],
          },
    );
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it("opens the Trace of the selected Run, under the Mission or the Agent", async () => {
    await act(async () => root.render(<TraceListPage />));
    const hrefs = [...container.querySelectorAll<HTMLAnchorElement>("a[data-testid='trace-run-link']")].map((a) =>
      a.getAttribute("href"),
    );
    expect(hrefs).toEqual([
      "/projects/project-1/missions/mission-1/runs/run-m/trace",
      "/projects/project-1/agents/article-writer/trace?runId=run-j",
      "/projects/project-1/missions/mission-2/runs/run-p/trace",
    ]);
    expect(container.textContent).toContain("Create Article");
    expect(container.textContent).toContain("Example Project");
    expect(container.textContent).toContain("1 min 5 s");
  });

  it("asks only for the Runs matching the filters", async () => {
    await act(async () => root.render(<TraceListPage />));
    const select = container.querySelector<HTMLSelectElement>("select[data-testid='trace-filter-status']");
    expect(select).not.toBeNull();
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set;
      setter?.call(select, "failed");
      select!.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const lastListCall = useQueryMock.mock.calls.filter((c) => c[0] === "listRecent").at(-1);
    expect(lastListCall?.[1]).toMatchObject({ status: "failed" });
  });
});
