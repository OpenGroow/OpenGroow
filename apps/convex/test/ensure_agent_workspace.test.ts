import { describe, expect, it, vi, beforeEach } from "vitest";
import { RUNTIME_OPENCLAW_EXEC } from "@opengroow/protocol";

const sent: { type: string; payload: { commandText?: string } }[] = [];
let agentsOutput = "[]";

vi.mock("../project_agents/runtime_calls", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../project_agents/runtime_calls")>();
  return {
    ...actual,
    sendAndAwait: vi.fn(async (_ctx: unknown, _instanceId: string, type: string, payload: { commandText?: string }) => {
      sent.push({ type, payload });
      const isList = payload.commandText === "openclaw agents list --json";
      return {
        status: 200,
        found: true,
        type: "runtime.openclaw.exec.result",
        payload: { ok: true, data: { success: true, exitCode: 0, output: isList ? agentsOutput : "" } },
      };
    }),
  };
});

import { ensureAgentWorkspace } from "../project_agents/workspace_compound_commands";

const ctx = {} as never;
const agents = (workspace: string) => JSON.stringify([{ id: "opengroow--source", workspace }]);

describe("ensureAgentWorkspace", () => {
  beforeEach(() => {
    sent.length = 0;
  });

  it("leaves an agent already on its workspace alone", async () => {
    agentsOutput = agents("/home/node/.openclaw/workspace-new");
    expect(await ensureAgentWorkspace(ctx, "i", "opengroow--source", "new")).toBeUndefined();
    expect(sent).toHaveLength(1);
  });

  it("moves an agent registered on another workspace to the expected one", async () => {
    agentsOutput = agents("/home/node/.openclaw/workspace-old");
    expect(await ensureAgentWorkspace(ctx, "i", "opengroow--source", "new")).toBe("/home/node/.openclaw/workspace-old");
    expect(sent[1]!.type).toBe(RUNTIME_OPENCLAW_EXEC);
    expect(sent[1]!.payload.commandText).toContain("agents.entries.opengroow--source.workspace");
    expect(sent[1]!.payload.commandText).toContain("/home/node/.openclaw/workspace-new");
  });

  it("does nothing for an agent OpenClaw does not know", async () => {
    agentsOutput = "[]";
    expect(await ensureAgentWorkspace(ctx, "i", "opengroow--source", "new")).toBeUndefined();
    expect(sent).toHaveLength(1);
  });
});
