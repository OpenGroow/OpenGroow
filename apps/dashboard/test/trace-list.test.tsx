/** @vitest-environment jsdom */

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TraceList } from "../src/components/trace/trace-list";
import { normalizeTrace } from "../src/lib/trace/normalize-trace";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ts = (s: number) => new Date(Date.UTC(2026, 0, 1, 0, 0, s)).toISOString();

describe("TraceList", () => {
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

  it("lists messages and tool calls in transcript order, failed calls visible", async () => {
    const events = normalizeTrace(
      [
        { kind: "message", role: "user", text: "Write the article", timestamp: ts(0) },
        { kind: "tool_call", toolName: "media__generate", toolCallId: "c1", arguments: { q: 1 }, timestamp: ts(1) },
        { kind: "tool_result", toolName: "media__generate", toolCallId: "c1", success: false, result: "boom", timestamp: ts(3) },
        { kind: "message", role: "assistant", text: "Done", timestamp: ts(4) },
      ],
      { id: "run-1", status: "completed" },
    );
    await act(async () => root.render(<TraceList events={events} />));

    const rows = Array.from(container.querySelectorAll("li"));
    expect(rows).toHaveLength(3);
    expect(rows[0].textContent).toContain("Instruction");
    expect(rows[1].textContent).toContain("generate");
    expect(rows[1].textContent).toContain("media");
    expect(rows[1].textContent).toContain("2.0 s");
    expect(rows[1].textContent).toContain("boom");
    expect(rows[1].querySelector('[data-testid="tool-status"]')!.textContent).toBe("Failed");
    expect(rows[2].textContent).toContain("Agent message");
    expect(container.querySelector("button")).toBeNull();
  });
});
