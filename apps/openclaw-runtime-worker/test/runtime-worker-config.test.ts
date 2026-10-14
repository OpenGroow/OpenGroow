import { describe, expect, it } from "vitest";
import { loadRuntimeWorkerConfig } from "../src/config/runtime-worker-config";

const validEnv = {
  BROKER_WS_URL: "ws://127.0.0.1:4300/openclaw",
  OPENCLAW_KEY_ID: "key-id",
  OPENCLAW_SECRET: "secret",
  OPENCLAW_CONTROL_SOCKET_PATH: "/tmp/openclaw.sock",
  OPENCLAW_GATEWAY_LOCAL_PORT: "18789",
  OPENCLAW_INSTANCE_ID: "instance-123",
  OPENCLAW_CONFIG_DIR: "/tmp/openclaw",
};

describe("loadRuntimeWorkerConfig", () => {
  it("fails when a required environment variable is missing", () => {
    expect(() =>
      loadRuntimeWorkerConfig({
        ...validEnv,
        OPENCLAW_SECRET: "",
      }),
    ).toThrow(/OPENCLAW_SECRET/);
  });

  it("fails when the gateway port is invalid", () => {
    expect(() =>
      loadRuntimeWorkerConfig({
        ...validEnv,
        OPENCLAW_GATEWAY_LOCAL_PORT: "0",
      }),
    ).toThrow(/positive integer/);
  });

  it("fails when the broker URL is invalid", () => {
    expect(() =>
      loadRuntimeWorkerConfig({
        ...validEnv,
        BROKER_WS_URL: "http://127.0.0.1:4300/openclaw",
      }),
    ).toThrow(/ws:\/\//);
  });
});
