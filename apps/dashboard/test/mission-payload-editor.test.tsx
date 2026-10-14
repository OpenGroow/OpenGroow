/** @vitest-environment jsdom */

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MissionPayloadField } from "@convex/template_manifest_contract";
import { MissionPayloadEditor } from "../src/components/mission-payload-editor";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("MissionPayloadEditor", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
    document.body.innerHTML = "";
  });

  const fields: MissionPayloadField[] = [
    { key: "category", label: "Category", type: "text", required: true },
  ];

  it("renders the raw JSON textarea (no toggle) when the mission type has no fields", async () => {
    await act(async () => {
      root.render(
        <MissionPayloadEditor fields={undefined} payloadText="{}" onChange={() => {}} rawMode={false} onRawModeChange={() => {}} />,
      );
    });

    expect(document.querySelector("textarea")).not.toBeNull();
    expect(document.querySelector("button")).toBeNull();
  });

  it("renders the field form (not the textarea) but keeps a raw-JSON escape hatch when fields are declared", async () => {
    const onRawModeChange = vi.fn();
    await act(async () => {
      root.render(
        <MissionPayloadEditor fields={fields} payloadText="{}" onChange={() => {}} rawMode={false} onRawModeChange={onRawModeChange} />,
      );
    });

    expect(document.querySelector("textarea")).toBeNull();
    const toggle = document.querySelector("button") as HTMLButtonElement;
    expect(toggle.textContent).toContain("raw JSON");

    await act(async () => {
      toggle.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onRawModeChange).toHaveBeenCalledWith(true);
  });

  it("shows the raw JSON textarea (with a back-to-form toggle) when rawMode is on, even with fields declared", async () => {
    await act(async () => {
      root.render(
        <MissionPayloadEditor fields={fields} payloadText='{"category":"b1"}' onChange={() => {}} rawMode={true} onRawModeChange={() => {}} />,
      );
    });

    expect(document.querySelector("textarea")).not.toBeNull();
    expect((document.querySelector("button") as HTMLButtonElement).textContent).toContain("Back to form");
  });
});
