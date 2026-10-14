/** @vitest-environment jsdom */

import * as React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { SecurityPageContent } from "../src/components/security-page-content";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/src/hooks/use-authenticated-instances", () => ({
  useAuthenticatedInstances: () => [
    { jobId: "job-1", openclawId: "instance-1", openclawGatewayToken: "token-123" },
  ],
}));
vi.mock("@/src/components/instance-danger-zone", () => ({
  InstanceDangerZone: () => <div>danger zone</div>,
}));

describe("SecurityPageContent", () => {
  it("shows the gateway token and no in-place OpenClaw update (the version is pinned in the image)", () => {
    const container = document.createElement("div");
    act(() => createRoot(container).render(<SecurityPageContent resolvedInstanceId="instance-1" />));

    expect(container.textContent).toContain("Gateway Token");
    expect(container.textContent).toContain("token-123");
    expect(container.textContent).not.toContain("OpenClaw Update");
    expect(container.textContent).not.toContain("Update OpenClaw");
  });
});
