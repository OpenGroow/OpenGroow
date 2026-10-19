/** @vitest-environment jsdom */

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { MissionPayloadField } from "@convex/template_manifest_contract";
import { MissionPayloadFields } from "../src/components/mission-payload-fields";
import { Input } from "@/components/ui/input";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("MissionPayloadFields", () => {
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

  const occasionFields: MissionPayloadField[] = [
    { key: "occasion", label: "Occasion", type: "text", required: true },
    { key: "theme", label: "Theme", type: "text", required: false },
  ];

  async function render(fields: MissionPayloadField[], payloadText: string, onChange: (next: string) => void) {
    await act(async () => {
      root.render(<MissionPayloadFields fields={fields} payloadText={payloadText} onChange={onChange} />);
    });
  }

  it("renders one labeled text input per declared field, pre-filled from the payload", async () => {
    await render(occasionFields, JSON.stringify({ occasion: "board-1", theme: "" }), () => {});

    const inputs = Array.from(document.querySelectorAll("input[type='text']")) as HTMLInputElement[];
    expect(inputs).toHaveLength(2);
    const boardInput = inputs.find((i) => i.value === "board-1");
    expect(boardInput).toBeTruthy();

    const labels = Array.from(document.querySelectorAll("label")).map((l) => l.textContent);
    expect(labels.some((l) => l?.includes("Occasion"))).toBe(true);
    expect(labels.some((l) => l?.includes("Theme"))).toBe(true);
  });

  it("marks required fields with an asterisk and sets the required attribute", async () => {
    await render(occasionFields, "{}", () => {});

    const labels = Array.from(document.querySelectorAll("label"));
    const boardLabel = labels.find((l) => l.textContent?.includes("Occasion"));
    expect(boardLabel?.textContent).toContain("*");
    const themeLabel = labels.find((l) => l.textContent?.includes("Theme"));
    expect(themeLabel?.textContent).not.toContain("*");

    const inputs = Array.from(document.querySelectorAll("input[type='text']")) as HTMLInputElement[];
    expect(inputs.some((i) => i.required)).toBe(true);
    expect(inputs.some((i) => !i.required)).toBe(true);
  });

  it("calls onChange with the updated payload JSON when a field is edited, keeping other keys intact", async () => {
    let latest = "";
    await render(occasionFields, JSON.stringify({ occasion: "", theme: "cats" }), (next) => {
      latest = next;
    });

    const boardInput = Array.from(document.querySelectorAll("input[type='text']")).find(
      (el) => (el as HTMLInputElement).value === "",
    ) as HTMLInputElement;

    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    await act(async () => {
      nativeInputValueSetter?.call(boardInput, "board-42");
      boardInput.dispatchEvent(new Event("input", { bubbles: true }));
    });

    expect(JSON.parse(latest)).toEqual({ occasion: "board-42", theme: "cats" });
  });

  it("renders a select with a leading placeholder plus the declared options for a select field", async () => {
    const selectFields: MissionPayloadField[] = [
      {
        key: "category",
        label: "Category",
        type: "select",
        required: true,
        options: [
          { value: "birthday", label: "Birthday" },
          { value: "apology", label: "Apology" },
        ],
      },
    ];
    await render(selectFields, "{}", () => {});

    const select = document.querySelector("select") as HTMLSelectElement;
    expect(select).toBeTruthy();
    const optionValues = Array.from(select.options).map((o) => o.value);
    expect(optionValues).toEqual(["", "birthday", "apology"]);
  });

  // Regression test: a required select with no matching option for its current
  // value silently falls back to displaying the browser's first <option> while
  // the actual .value (and payload) stays "" — the select *looks* filled in but
  // submitting still fails "category is required" with no visible cause. The
  // always-rendered placeholder option keeps the displayed state and the
  // payload in agreement.
  it("selects the placeholder (not the first real option) when a required select field has no value in the payload", async () => {
    const selectFields: MissionPayloadField[] = [
      {
        key: "category",
        label: "Category",
        type: "select",
        required: true,
        options: [
          { value: "love-letter", label: "Love letter" },
          { value: "anniversary", label: "Anniversary" },
        ],
      },
    ];
    await render(selectFields, JSON.stringify({ category: "" }), () => {});

    const select = document.querySelector("select") as HTMLSelectElement;
    expect(select.value).toBe("");
    expect(select.selectedOptions[0]?.value).toBe("");
  });

  it("labels the placeholder differently for required vs optional select fields", async () => {
    const selectFields: MissionPayloadField[] = [
      {
        key: "required-field",
        label: "Required Field",
        type: "select",
        required: true,
        options: [{ value: "a", label: "A" }],
      },
      {
        key: "optional-field",
        label: "Optional Field",
        type: "select",
        required: false,
        options: [{ value: "b", label: "B" }],
      },
    ];
    await render(selectFields, "{}", () => {});

    const selects = Array.from(document.querySelectorAll("select"));
    const placeholders = selects.map((s) => s.options[0]?.textContent);
    expect(placeholders).toEqual(["— Select —", "—"]);
  });

  // Number fields (e.g. create_chat_mock_video's turnCount, issue #336) render
  // as a bounded <Input type="number"> and must round-trip as a JSON number,
  // not a string — downstream contracts (see manifest-mission-types.test.ts)
  // rely on `typeof payload.turnCount === "number"`.
  const turnCountFields: MissionPayloadField[] = [
    { key: "turnCount", label: "Number of turns", type: "number", required: true, min: 3, max: 8 },
  ];

  it("renders a bounded number input for a number field, pre-filled from the payload", async () => {
    await render(turnCountFields, JSON.stringify({ turnCount: 5 }), () => {});

    const input = document.querySelector("input[type='number']") as HTMLInputElement;
    expect(input).toBeTruthy();
    expect(input.value).toBe("5");
    expect(input.min).toBe("3");
    expect(input.max).toBe("8");
    expect(input.required).toBe(true);
  });

  it("calls onChange with a numeric (not string) value when a number field is edited", async () => {
    let latest = "";
    await render(turnCountFields, "{}", (next) => {
      latest = next;
    });

    const input = document.querySelector("input[type='number']") as HTMLInputElement;
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    await act(async () => {
      nativeInputValueSetter?.call(input, "6");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });

    const parsed = JSON.parse(latest);
    expect(parsed.turnCount).toBe(6);
    expect(typeof parsed.turnCount).toBe("number");
  });

  it("clears the key entirely when a number field is emptied", async () => {
    let latest = "";
    await render(turnCountFields, JSON.stringify({ turnCount: 5 }), (next) => {
      latest = next;
    });

    const input = document.querySelector("input[type='number']") as HTMLInputElement;
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    await act(async () => {
      nativeInputValueSetter?.call(input, "");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });

    expect(JSON.parse(latest)).toEqual({});
  });
});
