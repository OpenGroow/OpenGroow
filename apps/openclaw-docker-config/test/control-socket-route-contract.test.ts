import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const serverPath = "apps/openclaw-docker-config/docker/control-socket-server.js";

describe("control-socket route composition", () => {
  it("routes workflow families through the shared adapter", async () => {
    const source = await readFile(serverPath, "utf8");

    expect(source).toContain("async function handleWorkflowRoute");
    for (const workflowName of [
      "authWorkflow",
      "nodeWorkflow",
      "whatsappWorkflow",
      "channelWorkflow",
      "workspaceWorkflow",
      "mcpWorkflow",
      "pluginsWorkflow",
      "openClawWorkflow",
    ]) {
      expect(source).toContain(`handleWorkflowRoute(req, res, ${workflowName}`);
    }
  });

  it("has no historical lifecycle handlers or route-owned stores", async () => {
    const source = await readFile(serverPath, "utf8");

    expect(source).not.toMatch(/async function handle(?:Auth|Nodes?|WhatsApp|Telegram|Ai|SpeechToText|Workspace|Mcp|OpenClaw)/);
    expect(source).not.toMatch(/authSessions\s*=\s*new Map/);
    expect(source).not.toMatch(/whatsAppPairSession\s*=/);
    expect(source).not.toMatch(/ALLOWED_(?:OPENCLAW|CLAWHUB)_ROOT_COMMANDS/);
    expect(source).not.toMatch(/function (?:tokenizeOpenClawCommand|normalizeOpenClawArgs)/);
  });
});
