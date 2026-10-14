import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { withGatewayToken } = require(
  "../docker/control-socket-openclaw.js",
) as {
  withGatewayToken: (
    args: string[],
    env?: { OPENCLAW_GATEWAY_TOKEN?: string },
  ) => string[];
};

describe("control socket OpenClaw gateway auth", () => {
  it("uses the shared Gateway token for node/device management commands", () => {
    expect(
      withGatewayToken(
        ["devices", "approve", "request-1"],
        { OPENCLAW_GATEWAY_TOKEN: "gateway-admin-token" },
      ),
    ).toEqual([
      "devices",
      "approve",
      "request-1",
      "--token",
      "gateway-admin-token",
    ]);
  });

  it("does not replace an explicitly supplied token", () => {
    expect(
      withGatewayToken(
        ["nodes", "list", "--token", "explicit-token"],
        { OPENCLAW_GATEWAY_TOKEN: "gateway-admin-token" },
      ),
    ).toEqual(["nodes", "list", "--token", "explicit-token"]);
  });

  it("leaves the command unchanged when no Gateway token is configured", () => {
    const args = ["nodes", "list", "--json"];
    expect(withGatewayToken(args, {})).toEqual(args);
    expect(withGatewayToken(args, {})).not.toBe(args);
  });
});
