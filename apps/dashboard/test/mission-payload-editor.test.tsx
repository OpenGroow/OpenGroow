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

  it("hides the raw JSON behind a discreet toggle when the mission type has no fields", async () => {
    const onRawModeChange = vi.fn();
    await act(async () => {
      root.render(
        <MissionPayloadEditor fields={undefined} payloadText="{}" onChange={() => {}} rawMode={false} onRawModeChange={onRawModeChange} />,
      );
    });

    expect(document.querySelector("textarea")).toBeNull();
    const toggle = document.querySelector("button") as HTMLButtonElement;
    expect(toggle.textContent).toBe("Edit as raw JSON");
    await act(async () => {
      toggle.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onRawModeChange).toHaveBeenCalledWith(true);
  });

  it("shows the raw JSON textarea with a hide toggle when rawMode is on and the type has no fields", async () => {
    await act(async () => {
      root.render(
        <MissionPayloadEditor fields={undefined} payloadText="{}" onChange={() => {}} rawMode={true} onRawModeChange={() => {}} />,
      );
    });

    expect(document.querySelector("textarea")).not.toBeNull();
    expect((document.querySelector("button") as HTMLButtonElement).textContent).toBe("Hide raw JSON");
  });

  it("keeps the field form and offers the raw JSON toggle when fields are declared", async () => {
    await act(async () => {
      root.render(
        <MissionPayloadEditor fields={fields} payloadText="{}" onChange={() => {}} rawMode={false} onRawModeChange={() => {}} />,
      );
    });

    expect(document.querySelector("textarea")).toBeNull();
    expect(document.querySelector("label")?.textContent).toContain("Category");
    expect((document.querySelector("button") as HTMLButtonElement).textContent).toBe("Edit as raw JSON");
  });

  it("shows only the undeclared and unreserved keys in the raw JSON, next to the fields", async () => {
    await act(async () => {
      root.render(
        <MissionPayloadEditor
          fields={fields}
          reservedKeys={["publishTargets"]}
          payloadText='{"category":"b1","publishTargets":["x"],"extra":1}'
          onChange={() => {}}
          rawMode={true}
          onRawModeChange={() => {}}
        />,
      );
    });

    expect(document.querySelector("label")?.textContent).toContain("Category");
    expect(JSON.parse((document.querySelector("textarea") as HTMLTextAreaElement).value)).toEqual({ extra: 1 });
    expect((document.querySelector("button") as HTMLButtonElement).textContent).toBe("Hide raw JSON");
  });

  it("merges the edited extra options into the payload without touching the fields", async () => {
    const onChange = vi.fn();
    await act(async () => {
      root.render(
        <MissionPayloadEditor fields={fields} payloadText='{"category":"b1"}' onChange={onChange} rawMode={true} onRawModeChange={() => {}} />,
      );
    });
    const textarea = document.querySelector("textarea") as HTMLTextAreaElement;
    const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;

    // A key a field owns is ignored: the field keeps its value.
    await act(async () => {
      setValue.call(textarea, '{"extra":2,"category":"zz"}');
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(JSON.parse(onChange.mock.lastCall![0])).toEqual({ extra: 2, category: "b1" });

    // Invalid JSON is not merged and blocks the form's submission.
    onChange.mockClear();
    await act(async () => {
      setValue.call(textarea, '{"extra":');
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(onChange).not.toHaveBeenCalled();
    expect(textarea.validity.valid).toBe(false);
  });
});
