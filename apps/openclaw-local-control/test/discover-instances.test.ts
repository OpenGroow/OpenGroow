import { describe, expect, it } from "vitest";
import { discoverExistingInstances } from "../src/discover-instances.js";
import type { DockerRunner } from "../src/default-docker-runner.js";

function inspectPayload(containers: unknown[]): string {
  return JSON.stringify(containers);
}

function container(opts: {
  id: string;
  created: string;
  project?: string;
  env?: string[];
}) {
  return {
    Id: opts.id,
    Created: opts.created,
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

describe("discoverExistingInstances", () => {
  it("reconstructs a known instance from its runtime-worker and gateway containers", async () => {
    const worker = container({
      id: "worker-1",
      created: "2026-07-20T00:00:00.000Z",
      project: "openclaw-abc123",
      env: ["OPENCLAW_INSTANCE_ID=abc123", "OPENCLAW_KEY_ID=key-abc", "OPENCLAW_SECRET=secret-abc"],
    });
    const gateway = container({
      id: "gateway-1",
      created: "2026-07-20T00:00:00.000Z",
      project: "openclaw-abc123",
      env: ["OPENCLAW_GATEWAY_PORT=19101"],
    });

    const instances = await discoverExistingInstances(
      makeDockerRunner({ "openclaw-runtime-worker": [worker], "openclaw-gateway": [gateway] })
    );

    expect(instances).toEqual([
      { id: "abc123", port: 19101, keyId: "key-abc", secret: "secret-abc", createdAt: "2026-07-20T00:00:00.000Z" },
    ]);
  });

  it("skips a container from a non-openclaw compose project", async () => {
    const worker = container({
      id: "worker-1",
      created: "t1",
      project: "opengroow",
      env: ["OPENCLAW_INSTANCE_ID=", "OPENCLAW_KEY_ID=", "OPENCLAW_SECRET="],
    });

    const instances = await discoverExistingInstances(
      makeDockerRunner({ "openclaw-runtime-worker": [worker], "openclaw-gateway": [] })
    );

    expect(instances).toEqual([]);
  });

  it("skips a worker whose gateway sibling isn't found (partial state)", async () => {
    const worker = container({
      id: "worker-1",
      created: "t1",
      project: "openclaw-orphan",
      env: ["OPENCLAW_INSTANCE_ID=orphan", "OPENCLAW_KEY_ID=key-orphan", "OPENCLAW_SECRET=secret-orphan"],
    });

    const instances = await discoverExistingInstances(
      makeDockerRunner({ "openclaw-runtime-worker": [worker], "openclaw-gateway": [] })
    );

    expect(instances).toEqual([]);
  });

  it("returns an empty list when no openclaw containers exist", async () => {
    const instances = await discoverExistingInstances(
      makeDockerRunner({ "openclaw-runtime-worker": [], "openclaw-gateway": [] })
    );

    expect(instances).toEqual([]);
  });
});
