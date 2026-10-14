import { describe, expect, it } from "vitest";
import { rolloutInstances } from "../src/rollout.js";
import type { DockerRunner } from "../src/default-docker-runner.js";
import type { ComposeRunner } from "../src/compose-runner.js";
import type { LocalControlConfig } from "../src/config.js";

function inspectPayload(containers: unknown[]): string {
  return JSON.stringify(containers);
}

function container(opts: { id: string; project?: string; env?: string[] }) {
  return {
    Id: opts.id,
    Created: "2026-07-20T00:00:00.000Z",
    Config: {
      Labels: opts.project ? { "com.docker.compose.project": opts.project } : {},
      Env: opts.env ?? [],
    },
  };
}

function makeDockerRunner(byService: Record<string, unknown[]>): DockerRunner {
  return async (args) => {
    if (args[0] === "ps") {
      const filterArg = args[args.indexOf("--filter") + 1];
      const service = filterArg.split("=").pop() as string;
      const containers = byService[service] ?? [];
      return { code: 0, stdout: containers.map((c) => (c as { Id: string }).Id).join("\n"), stderr: "" };
    }
    if (args[0] === "inspect") {
      const ids = args.slice(1);
      const all = Object.values(byService).flat() as { Id: string }[];
      const matched = all.filter((c) => ids.includes(c.Id));
      return { code: 0, stdout: inspectPayload(matched), stderr: "" };
    }
    throw new Error(`Unexpected docker invocation: ${args.join(" ")}`);
  };
}

const config: LocalControlConfig = {
  port: 4610,
  basePort: 19100,
  dockerDir: "/repo/apps/openclaw-docker-config/docker",
  composeFiles: ["docker-compose.yml", "docker-compose.local.yml"],
  gatewayImageRef: "opengroow/openclaw-gateway:local",
  runtimeWorkerImageRef: "opengroow/openclaw-runtime-worker:local",
  brokerWsUrl: "ws://host.docker.internal:4300/openclaw",
  dockerEventsEnabled: false,
  hmacMaxSkewMs: 0,
  brokerContainer: "opengroow-broker-1",
  brokerKeysFilePath: "/run/openclaw-secrets/openclaw-keys.json",
};

describe("rolloutInstances", () => {
  it("recreates every discovered instance's compose project with its own recovered credentials", async () => {
    const worker = container({
      id: "worker-1",
      project: "openclaw-abc123",
      env: ["OPENCLAW_INSTANCE_ID=abc123", "OPENCLAW_KEY_ID=key-abc", "OPENCLAW_SECRET=secret-abc"],
    });
    const gateway = container({
      id: "gateway-1",
      project: "openclaw-abc123",
      env: ["OPENCLAW_GATEWAY_PORT=19101", "OPENCLAW_GATEWAY_TOKEN=token-abc"],
    });
    const dockerRunner = makeDockerRunner({
      "openclaw-runtime-worker": [worker],
      "openclaw-gateway": [gateway],
    });

    const calls: Array<{ args: string[]; env: Record<string, string> }> = [];
    const composeRunner: ComposeRunner = async (args, options) => {
      calls.push({ args, env: options.env });
      return { code: 0, stdout: "", stderr: "" };
    };

    const results = await rolloutInstances({ config, composeRunner, dockerRunner });

    expect(results).toEqual([{ id: "abc123", ok: true }]);
    expect(calls).toHaveLength(1);
    expect(calls[0].args).toEqual(["-p", "openclaw-abc123", "-f", "docker-compose.yml", "-f", "docker-compose.local.yml", "up", "-d"]);
    expect(calls[0].env).toEqual({
      OPENCLAW_IMAGE_REF: "opengroow/openclaw-gateway:local",
      OPENCLAW_RUNTIME_WORKER_IMAGE_REF: "opengroow/openclaw-runtime-worker:local",
      OPENCLAW_INSTANCE_ID: "abc123",
      OPENCLAW_GATEWAY_PORT: "19101",
      OPENCLAW_KEY_ID: "key-abc",
      OPENCLAW_SECRET: "secret-abc",
      OPENCLAW_GATEWAY_TOKEN: "token-abc",
      BROKER_WS_URL: "ws://host.docker.internal:4300/openclaw",
    });
  });

  it("reports a failed recreation without throwing, and keeps rolling out the rest", async () => {
    const workers = [
      container({
        id: "worker-1",
        project: "openclaw-a",
        env: ["OPENCLAW_INSTANCE_ID=a", "OPENCLAW_KEY_ID=key-a", "OPENCLAW_SECRET=secret-a"],
      }),
      container({
        id: "worker-2",
        project: "openclaw-b",
        env: ["OPENCLAW_INSTANCE_ID=b", "OPENCLAW_KEY_ID=key-b", "OPENCLAW_SECRET=secret-b"],
      }),
    ];
    const gateways = [
      container({ id: "gateway-1", project: "openclaw-a", env: ["OPENCLAW_GATEWAY_PORT=19100", "OPENCLAW_GATEWAY_TOKEN=token-a"] }),
      container({ id: "gateway-2", project: "openclaw-b", env: ["OPENCLAW_GATEWAY_PORT=19101", "OPENCLAW_GATEWAY_TOKEN=token-b"] }),
    ];
    const dockerRunner = makeDockerRunner({
      "openclaw-runtime-worker": workers,
      "openclaw-gateway": gateways,
    });

    const composeRunner: ComposeRunner = async (args) => {
      const projectIndex = args.indexOf("-p") + 1;
      if (args[projectIndex] === "openclaw-b") {
        return { code: 1, stdout: "", stderr: "boom" };
      }
      return { code: 0, stdout: "", stderr: "" };
    };

    const results = await rolloutInstances({ config, composeRunner, dockerRunner });

    expect(results).toEqual([
      { id: "a", ok: true },
      { id: "b", ok: false, error: "boom" },
    ]);
  });

  it("skips a worker whose gateway sibling doesn't have a recoverable token", async () => {
    const worker = container({
      id: "worker-1",
      project: "openclaw-orphan",
      env: ["OPENCLAW_INSTANCE_ID=orphan", "OPENCLAW_KEY_ID=key-orphan", "OPENCLAW_SECRET=secret-orphan"],
    });
    const dockerRunner = makeDockerRunner({
      "openclaw-runtime-worker": [worker],
      "openclaw-gateway": [],
    });
    let called = false;
    const composeRunner: ComposeRunner = async () => {
      called = true;
      return { code: 0, stdout: "", stderr: "" };
    };

    const results = await rolloutInstances({ config, composeRunner, dockerRunner });

    expect(results).toEqual([]);
    expect(called).toBe(false);
  });

  it("returns an empty list when no local instances exist", async () => {
    const dockerRunner = makeDockerRunner({ "openclaw-runtime-worker": [], "openclaw-gateway": [] });
    const composeRunner: ComposeRunner = async () => ({ code: 0, stdout: "", stderr: "" });

    const results = await rolloutInstances({ config, composeRunner, dockerRunner });

    expect(results).toEqual([]);
  });
});
