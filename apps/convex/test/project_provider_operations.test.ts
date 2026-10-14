import { describe, expect, it } from "vitest";
import { RUNTIME_OPENCLAW_EXEC_RESULT } from "@opengroow/protocol";
import { parseRuntimeOpenClawExecPayload } from "../runtime_commands_node_parsers";

describe("Project developer-operation decoding", () => {
  it("keeps command text, output and exit code together", () => {
    expect(
      parseRuntimeOpenClawExecPayload(RUNTIME_OPENCLAW_EXEC_RESULT, {
        commandId: "cmd-1",
        instanceId: "instance-1",
        ok: false,
        error: "command failed",
        data: {
          commandText: "openclaw gateway restart",
          output: "stderr",
          exitCode: 7,
        },
      }),
    ).toMatchObject({
      ok: false,
      error: "command failed",
      data: {
        commandText: "openclaw gateway restart",
        output: "stderr",
        exitCode: 7,
      },
    });
  });

  it("rejects a result from a different Runtime command", () => {
    expect(
      parseRuntimeOpenClawExecPayload("runtime.health.result", {
        ok: true,
        data: { output: "ok" },
      }),
    ).toBeNull();
  });
});
