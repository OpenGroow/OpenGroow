#!/usr/bin/env node
// Smoke test for a RUNNING `pnpm start` stack (published images, local-control
// as a container with the Docker socket). It exercises what `pnpm dev` never
// does: local-control inside Docker creating, inspecting and deleting a real
// Project (gateway + runtime-worker containers) through its signed HTTP API.
//
//   pnpm start && pnpm start:smoke
//
// Steps: create a Project -> wait for its gateway to answer -> read logs and
// status -> delete it -> assert nothing is left behind.
//
// It creates (and deletes) a throwaway Project on the stack it targets: stop
// anything you care about being undisturbed, the broker is restarted to sync
// keys. Exit code 0 = all steps passed.
import { spawnSync } from "node:child_process";

const LOCAL_CONTROL = process.env.SMOKE_LOCAL_CONTROL_CONTAINER ?? "opengroow-openclaw-local-control-1";
const GATEWAY_READY_TIMEOUT_MS = Number(process.env.SMOKE_GATEWAY_TIMEOUT_MS ?? 180_000);

// Runs inside the local-control container: it has the Docker CLI, the socket,
// the signing key and @opengroow/hmac, so no port needs to be published.
const INNER = String.raw`
import { execFileSync } from "node:child_process";
import { HmacSigner, callSignedJsonApi } from "@opengroow/hmac";

const keys = JSON.parse(process.env.OPENCLAW_LOCAL_CONTROL_KEYS ?? "{}");
const keyId = Object.keys(keys)[0];
if (!keyId) throw new Error("OPENCLAW_LOCAL_CONTROL_KEYS has no key");
const signer = new HmacSigner({ keyId, secret: keys[keyId].secret, prefix: "control" });
const baseUrl = "http://127.0.0.1:" + (process.env.OPENCLAW_LOCAL_CONTROL_PORT ?? "4610");
const timeoutMs = ${GATEWAY_READY_TIMEOUT_MS};

const call = (method, path, body) =>
  callSignedJsonApi({ signer, baseUrl, method, path, body, timeoutMs: 120000, serviceName: "start-smoke" });
const docker = (...args) => {
  try {
    return execFileSync("docker", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (error) {
    return null;
  }
};
const step = (name) => console.log("[smoke] ok: " + name);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const leftovers = (id) => ({
  containers: (docker("ps", "-aq", "--filter", "name=openclaw-" + id) ?? "").split("\n").filter(Boolean),
  volumes: (docker("volume", "ls", "-q", "--filter", "name=openclaw-" + id) ?? "").split("\n").filter(Boolean),
});

let id;
try {
  const created = await call("POST", "/instances");
  if (created.error || !created.id) throw new Error("create failed: " + JSON.stringify(created));
  id = created.id;
  step("create Project " + id + " on port " + created.port);

  const gateway = "openclaw-" + id + "-openclaw-gateway-1";
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const out = docker("exec", gateway, "sh", "-c",
      "OPENCLAW_GATEWAY_URL=ws://127.0.0.1:18789 openclaw devices list --json");
    if (out && out.includes('"pending"')) break;
    if (Date.now() > deadline) throw new Error("gateway " + gateway + " did not answer in time");
    await sleep(3000);
  }
  step("gateway answers 'devices list'");

  const status = await call("POST", "/instances/status/openclaw", { port: created.port });
  if (status.error) throw new Error("status failed: " + JSON.stringify(status));
  step("read status");

  const logs = await call("POST", "/instances/logs/openclaw", { port: created.port, tail: 20 });
  if (logs.error) throw new Error("logs failed: " + JSON.stringify(logs));
  step("read logs");

  const removed = await call("DELETE", "/instances/" + id);
  if (removed.error || removed.removed !== true) throw new Error("delete failed: " + JSON.stringify(removed));
  step("delete Project");

  const left = leftovers(id);
  if (left.containers.length || left.volumes.length) {
    throw new Error("left behind after delete: " + JSON.stringify(left));
  }
  step("nothing left behind");
  id = undefined;
} catch (error) {
  console.error("[smoke] FAILED: " + (error instanceof Error ? error.message : String(error)));
  if (id) {
    // Do not leave a half-created Project eating disk.
    const left = leftovers(id);
    if (left.containers.length) docker("rm", "-f", ...left.containers);
    if (left.volumes.length) docker("volume", "rm", ...left.volumes);
    console.error("[smoke] cleaned containers/volumes of " + id + " (its registry entry may remain)");
  }
  process.exit(1);
}
`;

const result = spawnSync(
  "docker",
  ["exec", "-i", "-w", "/app", LOCAL_CONTROL, "node", "--input-type=module"],
  { input: INNER, stdio: ["pipe", "inherit", "inherit"] },
);

if (result.error) {
  console.error(`[smoke] could not run docker exec on ${LOCAL_CONTROL}: ${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
