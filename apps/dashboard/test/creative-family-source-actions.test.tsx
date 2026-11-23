/** @vitest-environment jsdom */

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CreativeUnclassifiedContent } from "../src/components/creative-unclassified-page";
import { useRemoveSources } from "../src/components/creative-family-source-actions";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const useQueryMock = vi.fn();
const usePaginatedQueryMock = vi.fn();
const assignMock = vi.fn();
const removeMock = vi.fn();
const noop = vi.fn().mockResolvedValue(undefined);

vi.mock("convex/react", () => ({
  useQuery: (...args: unknown[]) => useQueryMock(...args),
  usePaginatedQuery: (...args: unknown[]) => usePaginatedQueryMock(...args),
  useMutation: (ref: string) =>
    ref === "creative_family_sources.assign" ? assignMock : ref === "creative_family_sources.remove" ? removeMock : noop,
}));

vi.mock("@convex/_generated/api", () => ({
  api: {
    creative_families: { list: "creative_families.list", listUnclassified: "creative_families.listUnclassified" },
    creative_family_sources: { assign: "creative_family_sources.assign", remove: "creative_family_sources.remove" },
    source_thumbnails: { request: "source_thumbnails.request" },
    source_platforms: { forInstance: "source_platforms.forInstance" },
  },
}));

const FAMILIES = [
  { _id: "fam-a", name: "Reaction", status: "active" },
  { _id: "fam-b", name: "Old mechanic", status: "archived" },
];
const SOURCE = {
  _id: "src-1", templateId: "@opengroow/seo", sourceId: "post", label: "Post", family: "social-video",
  origin: "https://example.com/post-1", createdAt: Date.UTC(2026, 0, 15), marketing: { summary: "A loose clip" }, analysis: {},
};

describe("Creative Library Source classification", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    useQueryMock.mockReset().mockImplementation((key: string) => (key === "creative_families.list" ? FAMILIES : []));
    usePaginatedQueryMock.mockReset().mockReturnValue({ results: [SOURCE], status: "Exhausted", loadMore: vi.fn() });
    assignMock.mockReset().mockResolvedValue(null);
    removeMock.mockReset().mockResolvedValue(null);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it("lists unclassified Sources and assigns one from the picker, offering only active families", async () => {
    await act(async () => root.render(<CreativeUnclassifiedContent instanceId="instance-1" />));
    expect(container.textContent).toContain("A loose clip");
    const select = container.querySelector("select") as HTMLSelectElement;
    const options = Array.from(select.options).map((o) => o.textContent);
    expect(options).toContain("Reaction");
    expect(options).not.toContain("Old mechanic");
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!;
      setter.call(select, "fam-a");
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(assignMock).toHaveBeenCalledWith({ instanceId: "instance-1", sourceId: "src-1", familyId: "fam-a" });
  });

  it("shows an empty state when nothing is unclassified", async () => {
    usePaginatedQueryMock.mockReturnValue({ results: [], status: "Exhausted", loadMore: vi.fn() });
    await act(async () => root.render(<CreativeUnclassifiedContent instanceId="instance-1" />));
    expect(container.textContent).toContain("No unclassified Sources");
  });

  it("removes Sources from their family one after the other and keeps a refusal message", async () => {
    let hook!: ReturnType<typeof useRemoveSources>;
    function Probe() {
      hook = useRemoveSources("instance-1");
      return <p>{hook.error}</p>;
    }
    await act(async () => root.render(<Probe />));
    await act(async () => {
      expect(await hook.removeMany(["src-1", "src-2"])).toBe(true);
    });
    expect(removeMock).toHaveBeenNthCalledWith(1, { instanceId: "instance-1", sourceId: "src-1" });
    expect(removeMock).toHaveBeenNthCalledWith(2, { instanceId: "instance-1", sourceId: "src-2" });
    removeMock.mockRejectedValue(new Error("Forbidden"));
    await act(async () => {
      expect(await hook.removeMany(["src-3"])).toBe(false);
    });
    expect(container.textContent).toContain("Forbidden");
  });
});
