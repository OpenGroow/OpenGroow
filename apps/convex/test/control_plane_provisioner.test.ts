import { describe, expect, it, vi, afterEach, beforeAll } from "vitest";
import { HmacVerifier } from "@opengroow/hmac";

// Stub the control-plane env vars control_plane.ts's callControlApi reads lazily
// at call time (env.ts's getters), so the module can be imported without a
// real control-plane deployment — see mission_summary_http.test.ts
// for the same pattern.
beforeAll(() => {
  process.env.OPENCLAW_CONTROL_URL = "http://control.test";
  process.env.OPENCLAW_CONTROL_KEY_ID = "test-control-key";
  process.env.OPENCLAW_CONTROL_SECRET = "test-control-secret";
});

const { controlPlaneProvisioner } = await import("../instance_provisioning/control_plane");

function mockFetchOnce(status: number, body: unknown) {
  return vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
    new Response(JSON.stringify(body), { status }),
  );
}

describe("controlPlaneProvisioner (issue #304 widened InstanceProvisioner contract)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("createInstance POSTs /instances/jobs and returns the control-plane's job payload", async () => {
    const fetchSpy = mockFetchOnce(200, { job: { id: "job-1" }, status: 200 });

    const result = await controlPlaneProvisioner.createInstance(
      {} as never,
      { nameSuffix: "demo", userId: "user-1" },
    );

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://control.test/instances/jobs");
    expect(JSON.parse(init.body as string)).toEqual({ nameSuffix: "demo" });
    expect(result).toEqual({ job: { id: "job-1" }, status: 200 });
  });

  it("removeInstance POSTs /instances/delete with the job/server identifiers", async () => {
    const fetchSpy = mockFetchOnce(200, { status: 200, serverDeleted: true });

    const result = await controlPlaneProvisioner.removeInstance({} as never, {
      jobId: "job-1",
      serverId: 42,
      serverName: "openclaw-job-1",
      peerName: "openclaw-job-1",
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://control.test/instances/delete");
    expect(JSON.parse(init.body as string)).toEqual({
      jobId: "job-1",
      serverId: 42,
      serverName: "openclaw-job-1",
      peerName: "openclaw-job-1",
    });
    expect(result).toEqual({ status: 200, serverDeleted: true });
  });

  it("list fetches a single job by id when jobId is given", async () => {
    const fetchSpy = mockFetchOnce(200, { job: { id: "job-1" }, status: 200 });

    const result = await controlPlaneProvisioner.list({} as never, { jobId: "job-1" });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://control.test/instances/jobs/job-1");
    expect(init.method).toBe("GET");
    expect(result).toEqual({ job: { id: "job-1" }, status: 200 });
  });

  it("list fetches every job when jobId is omitted", async () => {
    const fetchSpy = mockFetchOnce(200, { jobs: [{ id: "job-1" }, { id: "job-2" }] });

    const result = await controlPlaneProvisioner.list({} as never, {});

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://control.test/instances/jobs");
    expect(result).toEqual({ jobs: [{ id: "job-1" }, { id: "job-2" }] });
  });

  it("logs POSTs /instances/logs/<target> with the target-specific args", async () => {
    const fetchSpy = mockFetchOnce(200, { lines: ["hello"] });

    const result = await controlPlaneProvisioner.logs({} as never, {
      target: "openclaw",
      ipv4: "1.2.3.4",
      service: "openclaw",
      tail: 100,
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://control.test/instances/logs/openclaw");
    expect(JSON.parse(init.body as string)).toEqual({
      ipv4: "1.2.3.4",
      service: "openclaw",
      tail: 100,
    });
    expect(result).toEqual({ lines: ["hello"] });
  });

  it("status POSTs /instances/status/<target> with the target-specific args", async () => {
    const fetchSpy = mockFetchOnce(200, { healthy: true });

    const result = await controlPlaneProvisioner.status({} as never, {
      target: "broker",
      serverId: 42,
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://control.test/instances/status/broker");
    expect(JSON.parse(init.body as string)).toEqual({ serverId: 42 });
    expect(result).toEqual({ healthy: true });
  });

  it("rollout POSTs /instances/rollout with the fleet-wide rollout args", async () => {
    const fetchSpy = mockFetchOnce(200, { job: { id: "rollout-1" } });

    const result = await controlPlaneProvisioner.rollout({} as never, {
      ips: ["1.2.3.4", "5.6.7.8"],
      openClawImageRef: "ghcr.io/opengroow/openclaw:latest",
      concurrency: 2,
      refreshCompose: true,
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://control.test/instances/rollout");
    expect(JSON.parse(init.body as string)).toEqual({
      ips: ["1.2.3.4", "5.6.7.8"],
      openClawImageRef: "ghcr.io/opengroow/openclaw:latest",
      concurrency: 2,
      refreshCompose: true,
    });
    expect(result).toEqual({ job: { id: "rollout-1" } });
  });

  // Contract (docs/CONTROL_PLANE.md): every request is HMAC-signed with the
  // "control" header prefix, configured by environment variables only.
  it("signs every request with the control HMAC headers built from the env vars", async () => {
    const fetchSpy = mockFetchOnce(200, { jobs: [] });

    await controlPlaneProvisioner.list({} as never, {});

    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const headers = new Headers(init.headers);
    expect(url).toBe("http://control.test/instances/jobs");
    expect(headers.get("x-control-key-id")).toBe("test-control-key");
    const verifier = new HmacVerifier({
      keyRegistry: { "test-control-key": { secret: "test-control-secret" } },
      prefix: "control",
    });
    expect(
      verifier.verify({ headers, method: "GET", path: "/instances/jobs" }),
    ).toEqual({ ok: true, keyId: "test-control-key" });
  });

  it("signs the exact JSON body it sends", async () => {
    const fetchSpy = mockFetchOnce(200, { status: 200 });

    await controlPlaneProvisioner.removeInstance({} as never, { jobId: "job-9" });

    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const verifier = new HmacVerifier({
      keyRegistry: { "test-control-key": { secret: "test-control-secret" } },
      prefix: "control",
    });
    expect(
      verifier.verify({
        headers: new Headers(init.headers),
        method: "POST",
        path: "/instances/delete",
        body: init.body as string,
      }).ok,
    ).toBe(true);
  });

  it("surfaces an unreachable control-plane as a {status, error} result instead of throwing", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("ECONNREFUSED"));

    const result = await controlPlaneProvisioner.list({} as never, {});

    expect(result).toEqual({ status: 502, error: "OpenClaw control service unreachable" });
  });

  it("passes a non-2xx control-plane error body through unchanged", async () => {
    mockFetchOnce(404, { status: 404, error: "Job not found" });

    const result = await controlPlaneProvisioner.list({} as never, { jobId: "nope" });

    expect(result).toEqual({ status: 404, error: "Job not found" });
  });
});
