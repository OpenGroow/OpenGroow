/** @vitest-environment jsdom */

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CreativeFamilyContent } from "../src/components/creative-family-page";
import { CreativeLibraryContent } from "../src/components/creative-library-page";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const createMock = vi.fn();
const updateMock = vi.fn();
const otherMutation = vi.fn();

vi.mock("convex/react", () => ({
  useQuery: (key: string) =>
    key === "creative_families.list"
      ? []
      : key === "creative_families.get"
        ? { _id: "fam-1", slug: "reaction", name: "Reaction", description: "A close-up", status: "active" }
        : key === "source_platforms.forInstance"
          ? []
          : undefined,
  usePaginatedQuery: () => ({ results: [], status: "Exhausted", loadMore: vi.fn() }),
  useMutation: (key: string) =>
    key === "creative_family_details.create" ? createMock : key === "creative_family_details.update" ? updateMock : otherMutation,
}));

vi.mock("@convex/_generated/api", () => ({
  api: {
    creative_families: { list: "creative_families.list", get: "creative_families.get", stats: "creative_families.stats", listSources: "creative_families.listSources" },
    creative_family_details: { create: "creative_family_details.create", update: "creative_family_details.update" },
    creative_families_archive: { archive: "x.archive", unarchive: "x.unarchive" },
    source_thumbnails: { request: "source_thumbnails.request" },
    source_platforms: { forInstance: "source_platforms.forInstance" },
  },
}));

describe("create and edit a Creative Family", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    createMock.mockReset().mockResolvedValue("new-id");
    updateMock.mockReset().mockResolvedValue(null);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  const press = async (label: string) => {
    const button = Array.from(document.body.querySelectorAll("button")).find((b) => b.textContent?.trim() === label);
    await act(async () => button?.click());
  };
  const fill = async (selector: string, value: string, proto: object) => {
    const field = document.body.querySelector(selector) as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(proto, "value")!.set!;
    await act(async () => {
      setter.call(field, value);
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
  };
  const submit = async () => {
    await act(async () => {
      (document.body.querySelector("form") as HTMLFormElement).requestSubmit();
    });
  };

  it("creates a family from the library, even when there is none yet", async () => {
    await act(async () => root.render(<CreativeLibraryContent instanceId="instance-1" />));
    await press("New family");
    await fill("#family-name", "  Silent Reaction ", HTMLInputElement.prototype);
    await fill("#family-description", "Close-up reaction", HTMLTextAreaElement.prototype);
    await submit();
    expect(createMock).toHaveBeenCalledWith({ instanceId: "instance-1", name: "Silent Reaction", description: "Close-up reaction" });
    expect(document.body.querySelector("form")).toBeNull();
  });

  it("shows the refusal and keeps the dialog open", async () => {
    createMock.mockRejectedValue(new Error('[Request ID: x] Server Error\nUncaught Error: A Creative Family named "Reaction" already exists\n    at handler'));
    await act(async () => root.render(<CreativeLibraryContent instanceId="instance-1" />));
    await press("New family");
    await fill("#family-name", "Reaction", HTMLInputElement.prototype);
    await fill("#family-description", "d", HTMLTextAreaElement.prototype);
    await submit();
    expect(document.body.querySelector('[role="alert"]')?.textContent).toBe('A Creative Family named "Reaction" already exists');
    expect(document.body.querySelector("form")).not.toBeNull();
  });

  it("edits name and description from the family page, prefilled", async () => {
    await act(async () => root.render(<CreativeFamilyContent instanceId="instance-1" familyId="fam-1" />));
    await press("Edit");
    expect((document.body.querySelector("#family-name") as HTMLInputElement).value).toBe("Reaction");
    expect((document.body.querySelector("#family-description") as HTMLTextAreaElement).value).toBe("A close-up");
    await fill("#family-name", "Silent Reaction", HTMLInputElement.prototype);
    await submit();
    expect(updateMock).toHaveBeenCalledWith({ instanceId: "instance-1", familyId: "fam-1", name: "Silent Reaction", description: "A close-up" });
  });
});
