/** @vitest-environment jsdom */

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CreativeFamilyArchiveButton } from "../src/components/creative-family-archive-button";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const archiveMock = vi.fn();
const unarchiveMock = vi.fn();

vi.mock("convex/react", () => ({
  useMutation: (ref: string) => (ref === "archive" ? archiveMock : unarchiveMock),
}));
vi.mock("@convex/_generated/api", () => ({
  api: { creative_families_archive: { archive: "archive", unarchive: "unarchive" } },
}));

describe("CreativeFamilyArchiveButton", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    archiveMock.mockReset().mockResolvedValue(null);
    unarchiveMock.mockReset().mockResolvedValue(null);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  async function render(archived: boolean) {
    await act(async () => {
      root.render(<CreativeFamilyArchiveButton instanceId="instance-1" familyId="fam-1" archived={archived} />);
    });
  }
  const button = () => container.querySelector("button") as HTMLButtonElement;

  it("archives an active family", async () => {
    await render(false);
    expect(button().textContent).toBe("Archive");
    await act(async () => button().click());
    expect(archiveMock).toHaveBeenCalledWith({ instanceId: "instance-1", familyId: "fam-1" });
    expect(unarchiveMock).not.toHaveBeenCalled();
  });

  it("unarchives an archived family", async () => {
    await render(true);
    expect(button().textContent).toBe("Unarchive");
    await act(async () => button().click());
    expect(unarchiveMock).toHaveBeenCalledWith({ instanceId: "instance-1", familyId: "fam-1" });
  });

  it("shows the server's refusal", async () => {
    archiveMock.mockRejectedValue(new Error("Forbidden"));
    await render(false);
    await act(async () => button().click());
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Forbidden");
  });
});
