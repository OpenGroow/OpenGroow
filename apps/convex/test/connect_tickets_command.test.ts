import { describe, expect, it } from "vitest";
import { buildNodeRunCommand } from "../connect_tickets_command";

describe("buildNodeRunCommand", () => {
  it("scopes the helper state to the stable instance id", () => {
    expect(
      buildNodeRunCommand({
        gatewayToken: "gateway-token",
        relayUrl: "wss://relay/connect/ticket-1/gateway",
        instanceId: "local-instance-a",
      }),
    ).toBe(
      "OPENCLAW_GATEWAY_TOKEN=gateway-token pnpm openclaw-connect:node-run -- " +
        "--relay-url wss://relay/connect/ticket-1/gateway " +
        "--state-key local-instance-a " +
        "--display-name 'My Computer'",
    );
  });

  it("quotes the instance id and display name as shell arguments", () => {
    expect(
      buildNodeRunCommand({
        gatewayToken: "gateway-token",
        relayUrl: "ws://relay/connect/ticket-1/gateway",
        instanceId: "instance with spaces",
        displayName: "Example Computer",
      }),
    ).toContain("--state-key 'instance with spaces'");
    expect(
      buildNodeRunCommand({
        gatewayToken: "gateway-token",
        relayUrl: "ws://relay/connect/ticket-1/gateway",
        instanceId: "instance-1",
        displayName: "Example Computer",
      }),
    ).toContain("--display-name 'Example Computer'");
  });
});
