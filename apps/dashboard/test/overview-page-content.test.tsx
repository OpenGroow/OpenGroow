/** @vitest-environment jsdom */

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OverviewPageContent } from "../src/components/overview-page-content";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const renameInstance = vi.fn();
const refreshOpenClawVersion = vi.fn();

vi.mock("convex/react", () => ({
  useAction: () => refreshOpenClawVersion,
  useMutation: () => renameInstance,
}));
vi.mock("@convex/_generated/api", () => ({
  api: {
    runtime_commands_node: { refreshOpenClawVersion: "refreshOpenClawVersion" },
    instances: { renameInstance: "renameInstance" },
  },
}));
vi.mock("@/src/hooks/use-authenticated-instances", () => ({
  useAuthenticatedInstances: () => [
    {
      jobId: "job-1",
      openclawId: "instance-1",
      displayName: "Marketing Ops",
      openclawVersion: "OpenClaw 2026.9.1 (ad6fe23)",
      providers: [],
    },
  ],
}));

describe("OverviewPageContent", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    renameInstance.mockReset().mockResolvedValue(undefined);
    refreshOpenClawVersion.mockReset().mockResolvedValue({ ok: true, version: "OpenClaw 2026.9.1 (ad6fe23)" });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => root.render(<OverviewPageContent resolvedInstanceId="instance-1" />));
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it("shows the OpenClaw version without its build hash, and no setup steps", () => {
    expect(container.textContent).toContain("OpenClaw Version");
    expect(container.textContent).toContain("2026.9.1");
    expect(container.textContent).not.toContain("ad6fe23");
    expect(container.textContent).not.toContain("Connect a Channel");
    expect(container.textContent).not.toContain("Next Steps");
  });

  it("edits the project name here", async () => {
    const input = container.querySelector<HTMLInputElement>("input#project-name");
    expect(input?.value).toBe("Marketing Ops");

    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    await act(async () => {
      setValue?.call(input, "  Growth Team ");
      input?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      container.querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

    expect(renameInstance).toHaveBeenCalledWith({ jobId: "job-1", displayName: "Growth Team" });
  });

  it("does not save an unchanged name", () => {
    const save = Array.from(container.querySelectorAll("button")).find((b) => b.textContent === "Save");
    expect(save?.disabled).toBe(true);
  });

  it("refreshes the version without printing the result: the Current version field is the one that updates", async () => {
    const refresh = Array.from(container.querySelectorAll("button")).find((b) => b.textContent === "Refresh version");
    await act(async () => refresh?.click());

    expect(refreshOpenClawVersion).toHaveBeenCalledWith({ instanceId: "instance-1" });
    expect(container.textContent).not.toContain("Saved runtime version");
    expect(container.querySelector("pre")).toBeNull();
  });

  it("has no explanatory copy around the refresh", () => {
    expect(container.textContent).not.toContain("Read the runtime version stored in Convex");
    expect(container.textContent).not.toContain("Reads the version from the running OpenClaw runtime");
  });
});
