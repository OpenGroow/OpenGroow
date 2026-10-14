import { describe, expect, it, vi, afterEach, beforeAll } from "vitest";
import { convexTest } from "convex-test";
import { internal } from "../_generated/api";
import schema from "../schema";
import { localProvisioner } from "../instance_provisioning/local";

// Pass modules explicitly to avoid import.meta.glob (not available in Node/edge-runtime).
// Must include a "_generated" path so convex-test can locate the module root.
const modules = {
  "../_generated/api.ts": () => import("../_generated/api.js"),
  "../instances.ts": () => import("../instances.js"),
  "../source_bootstrap.ts": () => import("../source_bootstrap.js"),
  "../source_bootstrap_node.ts": () => import("../source_bootstrap_node.js"),
};

// Stub the control-plane env vars local.ts's callLocalControlApi reads
// lazily at call time (env.ts's getters), matching control_plane_provisioner.test.ts's
// pattern for callControlApi.
beforeAll(() => {
  process.env.OPENCLAW_CONTROL_URL = "http://local-control.test";
  process.env.OPENCLAW_CONTROL_KEY_ID = "test-local-control-key";
  process.env.OPENCLAW_CONTROL_SECRET = "test-local-control-secret";
});

function mockFetchOnce(status: number, body: unknown) {
  return vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
    new Response(JSON.stringify(body), { status }),
  );
}

describe("localProvisioner (issue #306: local-multi wired into the local control-plane)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("createInstance POSTs /instances to the local control-plane and delegates its response to the createLocalInstance mutation", async () => {
    const fetchSpy = mockFetchOnce(201, {
      status: 201,
      id: "local-abc",
      port: 19101,
      keyId: "openclaw-abcd1234",
      secret: "instance-secret",
      gatewayToken: "instance-gateway-token",
      createdAt: "2026-07-22T00:00:00.000Z",
    });
    const runMutation = vi.fn().mockResolvedValue({ status: 200, job: { id: "local-abc" } });
    const ctx = { runMutation } as unknown as Parameters<
      typeof localProvisioner.createInstance
    >[0];

    const result = await localProvisioner.createInstance(ctx, {
      nameSuffix: "demo",
      userId: "user-1",
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://local-control.test/instances");
    expect(runMutation).toHaveBeenCalledWith(internal.instances.createLocalInstance, {
      nameSuffix: "demo",
      userId: "user-1",
      jobId: "local-abc",
      port: 19101,
      openclawKeyId: "openclaw-abcd1234",
      openclawGatewayToken: "instance-gateway-token",
    });
    expect(result).toEqual({ status: 200, job: { id: "local-abc" } });
  });

  it("createInstance returns the control-plane's error without calling the mutation when the HTTP call fails", async () => {
    const runMutation = vi.fn();
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ status: 502, error: "docker compose up failed" }), {
        status: 502,
      }),
    );
    const ctx = { runMutation } as unknown as Parameters<
      typeof localProvisioner.createInstance
    >[0];

    const result = await localProvisioner.createInstance(ctx, { userId: "user-1" });

    expect(runMutation).not.toHaveBeenCalled();
    expect(result).toEqual({ status: 502, error: "docker compose up failed" });
  });

  // Issue #307 wired removeInstance; issue #308 wired list/logs/status.
  // Only rollout has no local-multi equivalent yet — see the #306/#307/#308
  // commit messages for this deliberate scope boundary.
  it.each([
    ["rollout", () => localProvisioner.rollout({} as never, { ips: [] })],
  ])("%s makes no HTTP call and returns a not-supported result", async (_name, call) => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const result = await call();

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result.status).toBe(501);
    expect(result.error).toMatch(/not supported/i);
  });

  it("removeInstance DELETEs /instances/:jobId on the local control-plane and reports the instance as removed", async () => {
    const fetchSpy = mockFetchOnce(200, { status: 200, id: "local-abc", removed: true });

    const result = await localProvisioner.removeInstance({} as never, {
      jobId: "local-abc",
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://local-control.test/instances/local-abc");
    expect(init.method).toBe("DELETE");
    expect(result).toEqual({ status: 200, error: undefined, serverDeleted: true });
  });

  it("removeInstance surfaces the control-plane's error without throwing", async () => {
    const fetchSpy = mockFetchOnce(502, { status: 502, error: "docker compose down failed" });

    const result = await localProvisioner.removeInstance({} as never, {
      jobId: "local-abc",
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ status: 502, error: "docker compose down failed", serverDeleted: false });
  });

  it("list GETs /instances/:jobId on the local control-plane when a jobId is given", async () => {
    const fetchSpy = mockFetchOnce(200, {
      status: 200,
      job: { id: "local-abc", status: "succeeded", runtimeStatus: "linked" },
    });

    const result = await localProvisioner.list({} as never, { jobId: "local-abc" });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://local-control.test/instances/local-abc");
    expect(init.method).toBe("GET");
    expect(result).toEqual({
      status: 200,
      job: { id: "local-abc", status: "succeeded", runtimeStatus: "linked" },
    });
  });

  it("list GETs /instances (no jobId) to fetch every known instance", async () => {
    const fetchSpy = mockFetchOnce(200, { status: 200, jobs: [] });

    const result = await localProvisioner.list({} as never, {});

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://local-control.test/instances");
    expect(result).toEqual({ status: 200, jobs: [] });
  });

  it("logs POSTs /instances/logs/openclaw with the serverId forwarded as port", async () => {
    const fetchSpy = mockFetchOnce(200, { status: 200, output: "gateway logs" });

    const result = await localProvisioner.logs({} as never, {
      target: "openclaw",
      serverId: 19101,
      service: "openclaw-gateway",
      tail: 50,
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://local-control.test/instances/logs/openclaw");
    expect(JSON.parse(init.body as string)).toEqual({
      port: 19101,
      tail: 50,
      service: "openclaw-gateway",
    });
    expect(result).toEqual({ status: 200, output: "gateway logs" });
  });

  it("logs POSTs /instances/logs/broker without a port (the broker is a single shared container)", async () => {
    const fetchSpy = mockFetchOnce(200, { status: 200, output: "broker logs" });

    const result = await localProvisioner.logs({} as never, { target: "broker", tail: 100 });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://local-control.test/instances/logs/broker");
    expect(JSON.parse(init.body as string)).toEqual({ port: undefined, tail: 100, service: undefined });
    expect(result).toEqual({ status: 200, output: "broker logs" });
  });

  it("status POSTs /instances/status/openclaw with the serverId forwarded as port", async () => {
    const fetchSpy = mockFetchOnce(200, { status: 200, output: "openclaw ps" });

    const result = await localProvisioner.status({} as never, { target: "openclaw", serverId: 19101 });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://local-control.test/instances/status/openclaw");
    expect(JSON.parse(init.body as string)).toEqual({ port: 19101 });
    expect(result).toEqual({ status: 200, output: "openclaw ps" });
  });

  it("status POSTs /instances/status/broker without a port", async () => {
    const fetchSpy = mockFetchOnce(200, { status: 200, output: "broker ps" });

    const result = await localProvisioner.status({} as never, { target: "broker" });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://local-control.test/instances/status/broker");
    expect(JSON.parse(init.body as string)).toEqual({ port: undefined });
    expect(result).toEqual({ status: 200, output: "broker ps" });
  });
});

describe("instances.createLocalInstance mutation (issue #306: id/credentials sourced from the local control-plane)", () => {
  it("stores the control-plane-issued id as both jobId and openclawId, and returns a well-formed, already-linked job payload", async () => {
    const t = convexTest(schema, modules);
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const result = await t.mutation(internal.instances.createLocalInstance, {
      userId: "user-1",
      jobId: "local-abc",
      port: 19101,
      openclawKeyId: "openclaw-abcd1234",
      openclawGatewayToken: "instance-gateway-token",
    });

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result.status).toBe(200);
    expect(result.job).toMatchObject({
      id: "local-abc",
      status: "succeeded",
      // Unlike the remote control-plane, there's no VM to boot and no broker round-trip to
      // wait on: the compose-managed openclaw-gateway container is already
      // running, so the Project is immediately usable — never stuck in
      // "created" waiting on a runtime-link health-check keyed on the
      // wrong id (see ADR-033, docs/adr/033-local-multi-is-the-only-self-host-provisioning-model.md).
      runtimeStatus: "linked",
      runtimeReady: true,
      openclaw: {
        // Issue #308: the local control-plane's registry has no VM/serverId
        // of its own — the allocated gateway port doubles as this
        // instance's unique "serverId" so logs/status (which the dashboard
        // addresses by serverId, unmodified) can tell instances apart.
        serverId: 19101,
        openClawId: "local-abc",
        openClawKeyId: "openclaw-abcd1234",
        gatewayToken: "instance-gateway-token",
      },
    });

    fetchSpy.mockRestore();
  });

  // Issue #308: self-host runs exactly one shared broker container (not one
  // per instance — see local-control-server.ts), so brokerServerId only
  // needs to be *present* to make the dashboard's logs-panel.tsx show the
  // broker buttons (gated on `typeof instance.brokerServerId === "number"`)
  // — its value is never used to disambiguate which instance it targets.
  it("stores a brokerServerId sentinel so the dashboard's logs panel surfaces the shared broker's controls", async () => {
    const t = convexTest(schema, modules);

    const result = await t.mutation(internal.instances.createLocalInstance, {
      userId: "user-1",
      jobId: "local-abc",
      port: 19101,
      openclawKeyId: "openclaw-abcd1234",
    });

    const row = await t.run(async (ctx) =>
      ctx.db
        .query("instances")
        .filter((q) => q.eq(q.field("jobId"), result.job?.id))
        .first(),
    );
    expect(typeof row?.brokerServerId).toBe("number");
  });

  it("never schedules a runtime-link health-check (no VM boot to wait on, unlike the remote control-plane)", async () => {
    const t = convexTest(schema, modules);

    const result = await t.mutation(internal.instances.createLocalInstance, {
      userId: "user-1",
      jobId: "local-abc",
      port: 19101,
      openclawKeyId: "openclaw-abcd1234",
    });
    await t.finishInProgressScheduledFunctions();

    const row = await t.run(async (ctx) =>
      ctx.db
        .query("instances")
        .filter((q) => q.eq(q.field("jobId"), result.job?.id))
        .first(),
    );
    expect(row?.runtimeStatus).toBe("linked");
  });

  it("schedules the install of the Source Template, so a new Project gets it without blocking its creation (#673)", async () => {
    const t = convexTest(schema, modules);

    await t.mutation(internal.instances.createLocalInstance, {
      userId: "user-1",
      jobId: "local-boot",
      port: 19102,
      openclawKeyId: "openclaw-boot1234",
    });

    const scheduled = await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
    expect(scheduled.map((job) => job.args)).toEqual([[{ projectId: "local-boot" }]]);
  });

  it("schedules the Source install once, when a provisioned job first carries the OpenClaw id (#673)", async () => {
    const t = convexTest(schema, modules);
    const job = {
      id: "job-hz",
      status: "running" as const,
      runtimeStatus: "provisioning" as const,
      createdAt: new Date().toISOString(),
    };
    const withOpenclaw = {
      ...job,
      openclaw: { serverId: 7, name: "oc", openClawId: "openclaw-hz", openClawKeyId: "key-hz" },
    };

    await t.mutation(internal.instances.saveJob, { userId: "user-1", job, status: 202 });
    await t.mutation(internal.instances.saveJob, { userId: "user-1", job: withOpenclaw, status: 202 });
    await t.mutation(internal.instances.saveJob, { userId: "user-1", job: withOpenclaw, status: 202 });

    const scheduled = await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
    expect(scheduled.map((j) => j.args)).toEqual([[{ projectId: "openclaw-hz" }]]);
  });

  // Issue #306: the single-Project constraint (issue #262's 409) is gone —
  // each call to the local control-plane provisions its own isolated Docker
  // Compose project (issue #305), so Convex has no reason to reject a
  // second row anymore.
  it("creates a second, independently addressable Project on a second call — no more single-row constraint", async () => {
    const t = convexTest(schema, modules);

    const first = await t.mutation(internal.instances.createLocalInstance, {
      userId: "user-1",
      jobId: "local-first",
      port: 19101,
      openclawKeyId: "openclaw-first",
    });
    expect(first.status).toBe(200);

    const second = await t.mutation(internal.instances.createLocalInstance, {
      userId: "user-2",
      jobId: "local-second",
      port: 19102,
      openclawKeyId: "openclaw-second",
    });

    expect(second.status).toBe(200);
    expect(second.job?.id).toBe("local-second");
    expect(second.job?.id).not.toBe(first.job?.id);

    const rows = await t.run(async (ctx) => ctx.db.query("instances").collect());
    expect(rows).toHaveLength(2);
  });
});
