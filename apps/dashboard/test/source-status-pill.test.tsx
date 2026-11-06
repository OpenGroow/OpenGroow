/** @vitest-environment jsdom */

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SourcePipelinePill } from "../src/components/source-status-pill";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("SourcePipelinePill", () => {
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

  const pillOf = async (source: React.ComponentProps<typeof SourcePipelinePill>["source"]) => {
    await act(async () => root.render(<SourcePipelinePill source={source} />));
    return container.querySelector('[data-slot="status-badge"]') as HTMLElement;
  };

  const SCORED = { status: "ready" as const, scoring: { productFit: 0.7 } };
  const IN_PRODUCTION = { ...SCORED, selectedAt: 1, productionMissionId: "mission-1" };

  it("gives Scored and In production different colours, so they can be told apart", async () => {
    const scored = await pillOf(SCORED);
    expect(scored.textContent).toBe("Scored");
    const scoredClass = scored.className;
    const inProduction = await pillOf(IN_PRODUCTION);
    expect(inProduction.textContent).toBe("In production");
    expect(inProduction.className).not.toBe(scoredClass);
    expect(inProduction.className).toContain("border-brand-cyan");
    expect(scoredClass).toContain("border-tone-blue");
  });
});
