/** @vitest-environment jsdom */

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CreativeLibraryContent } from "../src/components/creative-library-page";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const useQueryMock = vi.fn();
const requestThumbnailsMock = vi.fn();

vi.mock("convex/react", () => ({
  useQuery: (...args: unknown[]) => useQueryMock(...args),
  useMutation: () => requestThumbnailsMock,
}));

vi.mock("@convex/_generated/api", () => ({
  api: {
    creative_families: { list: "creative_families.list" },
    source_thumbnails: { request: "source_thumbnails.request" },
    source_platforms: { forInstance: "source_platforms.forInstance" },
  },
}));

function makeFamily(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    _id: "fam-1",
    slug: "reaction",
    name: "Reaction",
    description: "A close-up reaction",
    status: "active",
    sourceCount: 5,
    sourceCountCapped: false,
    recentSources: [],
    ...overrides,
  };
}

function makeSource(id: string) {
  return {
    _id: id,
    templateId: "@opengroow/seo",
    sourceId: "post",
    label: "Post",
    family: "social-video",
    thumbnailUrl: `https://example.com/${id}.jpg`,
  };
}

describe("CreativeLibraryContent", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    useQueryMock.mockReset();
    requestThumbnailsMock.mockReset().mockResolvedValue(undefined);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  async function render(families: unknown[] | undefined) {
    useQueryMock.mockImplementation((key: string) =>
      key === "creative_families.list" ? families : key === "source_platforms.forInstance" ? [] : undefined,
    );
    await act(async () => {
      root.render(<CreativeLibraryContent instanceId="instance-1" />);
    });
  }

  const text = () => document.body.textContent ?? "";
  const names = () => Array.from(document.body.querySelectorAll("li a[data-family-name]")).map((a) => a.textContent);
  const press = async (label: string) => {
    const button = Array.from(document.body.querySelectorAll("button")).find((b) => b.textContent?.startsWith(label));
    await act(async () => {
      button?.click();
    });
  };
  const type = async (label: string, value: string) => {
    const input = document.body.querySelector(`input[aria-label="${label}"]`) as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    await act(async () => {
      setter.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  };

  it("shows loading then empty states", async () => {
    await render(undefined);
    expect(text()).toContain("Loading");
    await render([]);
    expect(text()).toContain("No Creative Families yet");
  });

  it("lists name, description, Source count, preview Sources and status with a link to the family", async () => {
    await render([makeFamily({ recentSources: [makeSource("a"), makeSource("b"), makeSource("c")] })]);

    expect(text()).toContain("Reaction");
    expect(text()).toContain("A close-up reaction");
    expect(text()).toContain("5 Sources");
    expect(text()).toContain("Active");
    expect(document.body.querySelectorAll("li img").length).toBe(3);
    const link = document.body.querySelector("li a[data-family-name]");
    expect(link?.getAttribute("href")).toBe("/projects/instance-1/library/fam-1");
  });

  it("flags empty families and families with a single Source", async () => {
    await render([
      makeFamily({ _id: "e", name: "Empty one", sourceCount: 0 }),
      makeFamily({ _id: "s", name: "Single one", sourceCount: 1 }),
      makeFamily({ _id: "m", name: "Many", sourceCount: 7 }),
    ]);
    const rows = Array.from(document.body.querySelectorAll("li")); // largest first
    expect(rows[0]?.textContent).not.toContain("Empty");
    expect(rows[0]?.textContent).not.toContain("Single Source");
    expect(rows[1]?.textContent).toContain("Single Source");
    expect(rows[2]?.textContent).toContain("Empty");
  });

  it("shows a capped count as 100+", async () => {
    await render([makeFamily({ sourceCount: 100, sourceCountCapped: true })]);
    expect(text()).toContain("100+ Sources");
  });

  it("searches by name", async () => {
    await render([makeFamily({ _id: "a", name: "Reaction" }), makeFamily({ _id: "b", name: "Unboxing" })]);
    await type("Search families", "unbox");
    expect(names()).toEqual(["Unboxing"]);
  });

  it("filters active, archived and empty families", async () => {
    await render([
      makeFamily({ _id: "a", name: "Live", sourceCount: 3 }),
      makeFamily({ _id: "b", name: "Old", status: "archived", sourceCount: 2 }),
      makeFamily({ _id: "c", name: "Nothing", sourceCount: 0 }),
    ]);
    expect(names()).toEqual(["Live", "Old", "Nothing"]);
    await press("Archived");
    expect(names()).toEqual(["Old"]);
    await press("Empty");
    expect(names()).toEqual(["Nothing"]);
    await press("Active");
    expect(names()).toEqual(["Live", "Nothing"]);
  });

  it("sorts by number of Sources, largest or smallest first", async () => {
    await render([
      makeFamily({ _id: "a", name: "Mid", sourceCount: 5 }),
      makeFamily({ _id: "b", name: "Big", sourceCount: 100, sourceCountCapped: true }),
      makeFamily({ _id: "c", name: "Small", sourceCount: 1 }),
    ]);
    const select = document.body.querySelector("select") as HTMLSelectElement;
    expect(names()).toEqual(["Big", "Mid", "Small"]);
    await act(async () => {
      const setValue = Object.getOwnPropertyDescriptor(select.constructor.prototype, "value")!.set!;
      setValue.call(select, "fewest");
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(names()).toEqual(["Small", "Mid", "Big"]);
  });
});
