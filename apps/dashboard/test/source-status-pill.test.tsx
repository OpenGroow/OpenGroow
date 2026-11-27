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

  it("tells Ingestion, Ready and Scored apart, and has no production stage any more", async () => {
    const scored = await pillOf(SCORED);
    expect(scored.textContent).toBe("Scored");
    expect(scored.className).toContain("border-tone-blue");
    expect((await pillOf({ status: "ready" })).textContent).toBe("Ready");
    expect((await pillOf({ status: "processing" })).textContent).toBe("Ingestion");
    // A Source that still carries the old production fields is simply Scored.
    expect((await pillOf({ ...SCORED, selectedAt: 1, productionMissionId: "mission-1" } as never)).textContent).toBe("Scored");
  });
});
