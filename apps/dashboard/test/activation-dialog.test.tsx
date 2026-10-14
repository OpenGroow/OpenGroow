/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentManifest } from "@convex/template_manifest_contract";
import { ActivationDialog } from "../src/components/activation-dialog";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const manifest = { id: "demo", name: "Demo", requirements: [] } as unknown as AgentManifest;

describe("ActivationDialog", () => {
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
    document.body.innerHTML = "";
  });

  async function submit(onSubmit: () => Promise<void>, onOpenChange = vi.fn()) {
    await act(async () => {
      root.render(<ActivationDialog manifest={manifest} open onOpenChange={onOpenChange} onSubmit={onSubmit} />);
    });
    const form = document.querySelector("form") as HTMLFormElement;
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    return onOpenChange;
  }

  it("keeps the dialog open and shows why when the submit fails", async () => {
    const onOpenChange = await submit(() => Promise.reject(new Error("Template demo is not reconfigurable")));
    expect(document.querySelector("[role='alert']")?.textContent).toBe("Template demo is not reconfigurable");
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("closes without an error when the submit succeeds", async () => {
    const onOpenChange = await submit(() => Promise.resolve());
    expect(document.querySelector("[role='alert']")).toBeNull();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
