import { afterEach, describe, expect, it } from "vitest";
import { loadLocalControlConfig } from "../src/config.js";

const originalBrokerWsUrl = process.env.BROKER_WS_URL;

afterEach(() => {
  if (originalBrokerWsUrl === undefined) delete process.env.BROKER_WS_URL;
  else process.env.BROKER_WS_URL = originalBrokerWsUrl;
});

describe("requireExplicitKeys", () => {
  afterEach(() => {
    delete process.env.OPENCLAW_LOCAL_CONTROL_REQUIRE_KEYS;
  });

  it("is off by default and on when the container sets OPENCLAW_LOCAL_CONTROL_REQUIRE_KEYS", () => {
    expect(loadLocalControlConfig().requireExplicitKeys).toBe(false);
    process.env.OPENCLAW_LOCAL_CONTROL_REQUIRE_KEYS = "1";
    expect(loadLocalControlConfig().requireExplicitKeys).toBe(true);
  });
});

describe("loadLocalControlConfig", () => {
  it("uses the Docker Desktop broker URL by default", () => {
    delete process.env.BROKER_WS_URL;

    expect(loadLocalControlConfig().brokerWsUrl).toBe(
      "ws://host.docker.internal:4300/openclaw",
    );
  });

  it("allows deployments to override the broker URL", () => {
    process.env.BROKER_WS_URL = "ws://broker.internal:4300/openclaw";

    expect(loadLocalControlConfig().brokerWsUrl).toBe(
      "ws://broker.internal:4300/openclaw",
    );
  });

  it("defaults the instance compose directory to the repository's", () => {
    delete process.env.OPENCLAW_LOCAL_CONTROL_DOCKER_DIR;

    expect(loadLocalControlConfig().dockerDir).toMatch(/apps\/openclaw-docker-config\/docker$/);
  });

  it("lets the containerized deployment point at the host-identical compose directory", () => {
    process.env.OPENCLAW_LOCAL_CONTROL_DOCKER_DIR = "/srv/opengroow/apps/openclaw-docker-config/docker";
    try {
      expect(loadLocalControlConfig().dockerDir).toBe("/srv/opengroow/apps/openclaw-docker-config/docker");
    } finally {
      delete process.env.OPENCLAW_LOCAL_CONTROL_DOCKER_DIR;
    }
  });
});
