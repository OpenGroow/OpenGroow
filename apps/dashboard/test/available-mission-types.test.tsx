/** @vitest-environment jsdom */

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { manifestFixture } from "./fixtures/manifests";
import { AvailableMissionTypes } from "../src/components/available-mission-types";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// jsdom has no PointerEvent, which the Checkbox primitive dispatches on click.
globalThis.PointerEvent ??= MouseEvent as typeof PointerEvent;

const LYM = "Create letter video";
const CHAT_MOCK = "Create chat mock video";

function checkbox(label: string): HTMLElement {
  const el = Array.from(document.querySelectorAll("label"))
    .find((l) => l.textContent?.includes(label))
    ?.querySelector('[role="checkbox"]');
  if (!(el instanceof HTMLElement)) throw new Error(`Checkbox not found: ${label}`);
  return el;
}

const isChecked = (el: HTMLElement) => el.getAttribute("aria-checked") === "true";

function applyButton(): HTMLButtonElement {
  const el = Array.from(document.querySelectorAll("button")).find((b) => b.textContent?.includes("Save changes"));
  if (!(el instanceof HTMLButtonElement)) throw new Error("Save changes not found");
  return el;
}

describe("AvailableMissionTypes", () => {
  const missionTypes = manifestFixture("video-demo").missionTypes!;
  const onApply = vi.fn();
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    onApply.mockReset();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  async function render(hidden: string[] | undefined, saving = false) {
    await act(async () => {
      root.render(
        <AvailableMissionTypes missionTypes={missionTypes} hidden={hidden} saving={saving} onApply={onApply} />,
      );
    });
  }

  it("checks the types that are visible, i.e. not in the stored deny-list", async () => {
    await render(["create_chat_mock_video"]);
    expect(document.body.textContent).toContain("Available Mission types");
    expect(isChecked(checkbox(LYM))).toBe(true);
    expect(isChecked(checkbox(CHAT_MOCK))).toBe(false);
  });

  it("checks every type when nothing is hidden", async () => {
    await render(undefined);
    expect(isChecked(checkbox(LYM))).toBe(true);
    expect(isChecked(checkbox(CHAT_MOCK))).toBe(true);
  });

  it("keeps Save changes disabled until the selection changes", async () => {
    await render([]);
    expect(applyButton().disabled).toBe(true);
    await act(async () => checkbox(LYM).click());
    expect(applyButton().disabled).toBe(false);
    await act(async () => checkbox(LYM).click());
    expect(applyButton().disabled).toBe(true);
  });

  it("applies the unchecked types as the new deny-list", async () => {
    await render(["create_chat_mock_video"]);
    await act(async () => checkbox(CHAT_MOCK).click());
    await act(async () => checkbox(LYM).click());
    await act(async () => applyButton().click());
    expect(onApply).toHaveBeenCalledWith(["lym_create_letter_video"]);
  });
});
