/** @vitest-environment jsdom */

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import DeveloperPage from "../app/(app)/developer/page";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const useActionMock = vi.fn();
const useAuthenticatedInstancesMock = vi.fn();

vi.mock("convex/react", () => ({
  useAction: (...args: unknown[]) => useActionMock(...args),
}));

vi.mock("@convex/_generated/api", () => ({
  api: {
    instances_node: {
      getOpenClawStatus: "instances_node.getOpenClawStatus",
      getOpenClawLogs: "instances_node.getOpenClawLogs",
      getBrokerStatus: "instances_node.getBrokerStatus",
      getBrokerLogs: "instances_node.getBrokerLogs",
    },
  },
}));

vi.mock("@/src/hooks/use-authenticated-instances", () => ({
  useAuthenticatedInstances: () => useAuthenticatedInstancesMock(),
}));

describe("Developer page", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    useActionMock.mockReturnValue(vi.fn());
    useAuthenticatedInstancesMock.mockReturnValue([]);

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

  it("labels the panel Developer instead of Diagnostics/Runtime Logs", async () => {
    await act(async () => {
      root.render(<DeveloperPage />);
    });

    expect(container.textContent).toContain("Developer");
    expect(container.textContent).not.toContain("Diagnostics");
    expect(container.textContent).not.toContain("Runtime Logs");
  });
});
