/** @vitest-environment jsdom */

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ScheduleCadenceEditor } from "../src/components/schedule-cadence-editor";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("ScheduleCadenceEditor", () => {
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
  });

  function setValue(el: HTMLInputElement | HTMLSelectElement, value: string) {
    const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value);
    el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
  }

  it("saves a new cadence for the Schedule", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    await act(async () => {
      root.render(<ScheduleCadenceEditor schedule={{ unit: "weekly", dayOfWeek: 1, hour: 8, minute: 0 }} onSave={onSave} />);
    });

    await act(async () => setValue(container.querySelector("select[name=unit]")!, "daily"));
    await act(async () => setValue(container.querySelector("input[name=hour]")!, "18"));
    await act(async () => container.querySelector<HTMLButtonElement>("button[data-action=save-cadence]")!.click());

    expect(onSave).toHaveBeenCalledWith({ unit: "daily", hour: 18, minute: 0 });
  });

  it("keeps the day of the week when the cadence stays weekly", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    await act(async () => {
      root.render(<ScheduleCadenceEditor schedule={{ unit: "weekly", dayOfWeek: 1, hour: 8, minute: 0 }} onSave={onSave} />);
    });
    await act(async () => setValue(container.querySelector("select[name=dayOfWeek]")!, "4"));
    await act(async () => container.querySelector<HTMLButtonElement>("button[data-action=save-cadence]")!.click());
    expect(onSave).toHaveBeenCalledWith({ unit: "weekly", dayOfWeek: 4, hour: 8, minute: 0 });
  });
});
