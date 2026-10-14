import { describe, expect, it } from "vitest";
import {
  RUNTIME_AI_CONFIG_SET_RESULT,
  RUNTIME_HEALTH_RESULT,
} from "@opengroow/protocol";
import { validateRuntimeEventPayload } from "../events.js";

describe("validateRuntimeEventPayload", () => {
  it("accepts a structurally valid Runtime result", () => {
    const result = validateRuntimeEventPayload(RUNTIME_HEALTH_RESULT, {
      commandId: "cmd-1",
      instanceId: "instance-1",
      ok: true,
      data: { output: "healthy" },
    });

    expect(result).toEqual({
      ok: true,
      payload: {
        commandId: "cmd-1",
        instanceId: "instance-1",
        ok: true,
        data: { output: "healthy" },
      },
    });
  });

  it("rejects malformed Runtime results before a caller can map them", () => {
    const result = validateRuntimeEventPayload(RUNTIME_AI_CONFIG_SET_RESULT, {
      commandId: "cmd-1",
      instanceId: "instance-1",
      ok: true,
      data: "not-an-object",
    });

    expect(result).toEqual({ ok: false, error: "Invalid Runtime result payload" });
  });

  it("leaves non-Runtime events to their own domain contract", () => {
    expect(validateRuntimeEventPayload("manual.note", { text: "hello" })).toEqual({
      ok: true,
      payload: { text: "hello" },
    });
  });
});
