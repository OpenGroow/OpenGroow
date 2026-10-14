/** @vitest-environment jsdom */

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { describe, expect, it } from "vitest";
import {
  useWorkspaceOperation,
  type WorkspaceCommandResult,
  type WorkspaceOperationRequest,
} from "../src/hooks/use-workspace-operations";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
};

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe("useWorkspaceOperation", () => {
  it("does not apply a resolved result once the caller has unmounted", async () => {
    const deferred = createDeferred<{ value: string } | { error: string }>();
    let latestResult: WorkspaceCommandResult<{ value: string }> = { status: "idle" };
    const request: ({ instanceId: string } & WorkspaceOperationRequest) = {
      instanceId: "instance-1",
      resetKey: 0,
    };
    const run = () => deferred.promise;

    function HookComponent() {
      const result = useWorkspaceOperation<{ instanceId: string }, { value: string }>({
        request,
        run,
      });
      latestResult = result;
      return null;
    }

    const container = document.createElement("div");
    document.body.appendChild(container);
    let root: Root;
    await act(async () => {
      root = createRoot(container);
      root.render(React.createElement(HookComponent));
    });

    expect(latestResult.status).toBe("loading");

    await act(async () => {
      root.unmount();
    });
    container.remove();

    // The promise resolves only after the component has unmounted — the
    // cleanup's `cancelled` flag must stop this from ever reaching setState.
    await act(async () => {
      deferred.resolve({ value: "too late" });
      await deferred.promise;
    });

    expect(latestResult.status).toBe("loading");
  });

  it("surfaces a business error response as status: error", async () => {
    let latestResult: WorkspaceCommandResult<{ value: string }> = { status: "idle" };
    const request: ({ instanceId: string } & WorkspaceOperationRequest) = {
      instanceId: "instance-1",
      resetKey: 0,
    };
    const run = async () => ({ error: "boom" });

    function HookComponent() {
      const result = useWorkspaceOperation<{ instanceId: string }, { value: string }>({
        request,
        run,
      });
      latestResult = result;
      return null;
    }

    const container = document.createElement("div");
    document.body.appendChild(container);
    await act(async () => {
      const root = createRoot(container);
      root.render(React.createElement(HookComponent));
    });

    expect(latestResult).toEqual({ status: "error", error: "boom" });
  });
});
