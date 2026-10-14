/** @vitest-environment jsdom */

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AUTH_RESTART_RECOVERY_MESSAGE,
  useProviderAuth,
  type ProviderAuthActions,
  type UseProviderAuthResult,
} from "../src/hooks/use-provider-auth";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// A minimal test harness that renders the hook inside a function component
// and captures the latest result via a ref — mirrors
// apps/dashboard/test/use-workspace-command.test.ts, no @testing-library/react.
function createHookHarness(runtimeInstanceId: string | undefined, actions: ProviderAuthActions) {
  let latestResult: UseProviderAuthResult;
  let root: Root;
  let container: HTMLDivElement;

  function HookComponent() {
    const result = useProviderAuth(runtimeInstanceId, actions);
    latestResult = result;
    return null;
  }

  async function mount() {
    container = document.createElement("div");
    document.body.appendChild(container);
    await act(async () => {
      root = createRoot(container);
      root.render(React.createElement(HookComponent));
    });
  }

  async function unmount() {
    await act(async () => {
      root.unmount();
    });
    container.remove();
    document.body.innerHTML = "";
  }

  function getResult() {
    return latestResult;
  }

  return { mount, unmount, getResult };
}

function createActions(): {
  actions: ProviderAuthActions;
  startAuth: ReturnType<typeof vi.fn>;
  getAuthJob: ReturnType<typeof vi.fn>;
  sendAuthInput: ReturnType<typeof vi.fn>;
  cancelAuth: ReturnType<typeof vi.fn>;
} {
  const startAuth = vi.fn();
  const getAuthJob = vi.fn();
  const sendAuthInput = vi.fn();
  const cancelAuth = vi.fn();
  return {
    actions: { startAuth, getAuthJob, sendAuthInput, cancelAuth },
    startAuth,
    getAuthJob,
    sendAuthInput,
    cancelAuth,
  };
}

describe("useProviderAuth", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(async () => {
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  it("goes start -> waiting_input -> success", async () => {
    const { actions, startAuth, getAuthJob } = createActions();
    startAuth.mockResolvedValue({ job: { id: "job-1", status: "queued", awaitingResume: false } });
    getAuthJob
      .mockResolvedValueOnce({
        job: {
          status: "waiting_input",
          logs: ["Open this URL in your LOCAL browser: https://auth.example/openai"],
          awaitingResume: false,
        },
      })
      .mockResolvedValueOnce({ job: { status: "succeeded", logs: [] } });

    const harness = createHookHarness("inst-1", actions);
    await harness.mount();

    await act(async () => {
      await harness.getResult().startAuth("openai");
    });

    expect(startAuth).toHaveBeenCalledWith({ instanceId: "inst-1", provider: "openai" });
    expect(harness.getResult().job.id).toBe("job-1");

    // First poll fires immediately once polling starts.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(harness.getResult().job.status).toBe("waiting_input");
    expect(harness.getResult().authCanAcceptRedirectInput).toBe(true);
    expect(harness.getResult().authBrowserUrl).toBe("https://auth.example/openai");

    await act(async () => {
      vi.advanceTimersByTime(4001);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(harness.getResult().job.status).toBe("succeeded");
    expect(harness.getResult().authSucceeded).toBe(true);

    await harness.unmount();
  });

  it("cancels a running auth job and resets the flow", async () => {
    const { actions, startAuth, getAuthJob, cancelAuth } = createActions();
    startAuth.mockResolvedValue({ job: { id: "job-2", status: "waiting_input", awaitingResume: false } });
    getAuthJob.mockResolvedValue({ job: { status: "waiting_input", logs: [] } });
    cancelAuth.mockResolvedValue({});

    const harness = createHookHarness("inst-1", actions);
    await harness.mount();

    await act(async () => {
      await harness.getResult().startAuth("openai");
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(harness.getResult().job.id).toBe("job-2");

    await act(async () => {
      await harness.getResult().cancelAuth();
    });

    expect(cancelAuth).toHaveBeenCalledWith({ jobId: "job-2", instanceId: "inst-1" });
    expect(harness.getResult().job.id).toBeUndefined();
    expect(harness.getResult().job.status).toBeUndefined();
    expect(harness.getResult().authHasStarted).toBe(false);

    await harness.unmount();
  });

  it("recovers a lost session while polling by resetting to the restart-recovery message", async () => {
    const { actions, startAuth, getAuthJob } = createActions();
    startAuth.mockResolvedValue({ job: { id: "job-3", status: "queued", awaitingResume: false } });
    getAuthJob.mockResolvedValue({ error: "Auth session not found" });

    const harness = createHookHarness("inst-1", actions);
    await harness.mount();

    await act(async () => {
      await harness.getResult().startAuth("openai");
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(harness.getResult().job.status).toBe("failed");
    expect(harness.getResult().job.error).toBe(AUTH_RESTART_RECOVERY_MESSAGE);
    expect(harness.getResult().job.id).toBeUndefined();
    expect(harness.getResult().authRestartRecovered).toBe(true);

    await harness.unmount();
  });

  it("blocks resume with awaitingResume when the gateway restarted mid-authorization", async () => {
    const { actions, startAuth, getAuthJob, sendAuthInput } = createActions();
    startAuth.mockResolvedValue({ job: { id: "job-4", status: "waiting_input", awaitingResume: false } });
    getAuthJob.mockResolvedValue({ job: { status: "waiting_input", logs: [] } });
    sendAuthInput.mockResolvedValue({ error: AUTH_RESTART_RECOVERY_MESSAGE });

    const harness = createHookHarness("inst-1", actions);
    await harness.mount();

    await act(async () => {
      await harness.getResult().startAuth("openai");
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    act(() => {
      harness.getResult().setAuthInput("http://localhost:1455/callback?code=abc");
    });

    await act(async () => {
      await harness.getResult().sendAuthInput(false);
    });

    expect(harness.getResult().job.status).toBe("failed");
    expect(harness.getResult().job.error).toBe(AUTH_RESTART_RECOVERY_MESSAGE);
    expect(harness.getResult().job.awaitingResume).toBe(true);
    expect(harness.getResult().authRestartRecovered).toBe(true);
    // Input can no longer be accepted on the now-failed job — user must restart.
    expect(harness.getResult().authCanAcceptRedirectInput).toBe(false);

    await harness.unmount();
  });
});
