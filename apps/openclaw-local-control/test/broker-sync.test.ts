import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildOpenClawKeyRegistry, syncBrokerOpenClawKeys, BrokerSyncError } from "../src/broker-sync.js";
import type { KnownInstance } from "../src/registry.js";
import type { DockerRunner } from "../src/default-docker-runner.js";

describe("buildOpenClawKeyRegistry", () => {
  it("maps each known instance to an OpenClaw-keys record keyed by its keyId", () => {
    const instances: KnownInstance[] = [
      { id: "local-1", port: 19100, keyId: "openclaw-aaa", secret: "secret-a", createdAt: "t1" },
      { id: "local-2", port: 19101, keyId: "openclaw-bbb", secret: "secret-b", createdAt: "t2" }
    ];

    expect(buildOpenClawKeyRegistry(instances)).toEqual({
      "openclaw-aaa": { openClawId: "local-1", secret: "secret-a" },
      "openclaw-bbb": { openClawId: "local-2", secret: "secret-b" }
    });
  });

  it("returns an empty registry when there are no known instances (last instance removed)", () => {
    expect(buildOpenClawKeyRegistry([])).toEqual({});
  });
});

describe("syncBrokerOpenClawKeys", () => {
  it("copies the regenerated keys file into the broker container, then restarts it", async () => {
    const calls: string[][] = [];
    let copiedContent: string | undefined;
    const dockerRunner: DockerRunner = async (args) => {
      calls.push(args);
      if (args[0] === "cp") {
        copiedContent = readFileSync(args[1], "utf8");
      }
      return { code: 0, stdout: "", stderr: "" };
    };

    await syncBrokerOpenClawKeys(
      { dockerRunner, brokerContainer: "opengroow-broker-1", brokerKeysFilePath: "/run/openclaw-secrets/openclaw-keys.json" },
      { "openclaw-aaa": { openClawId: "local-1", secret: "secret-a" } }
    );

    expect(calls).toHaveLength(2);
    expect(calls[0][0]).toBe("cp");
    expect(calls[0][2]).toBe("opengroow-broker-1:/run/openclaw-secrets/openclaw-keys.json");
    expect(calls[1]).toEqual(["restart", "opengroow-broker-1"]);
    expect(JSON.parse(copiedContent ?? "")).toEqual({
      "openclaw-aaa": { openClawId: "local-1", secret: "secret-a" }
    });
  });

  it("throws a BrokerSyncError and never restarts when the copy step fails", async () => {
    const calls: string[][] = [];
    const dockerRunner: DockerRunner = async (args) => {
      calls.push(args);
      return { code: 1, stdout: "", stderr: "No such container" };
    };

    await expect(
      syncBrokerOpenClawKeys(
        { dockerRunner, brokerContainer: "opengroow-broker-1", brokerKeysFilePath: "/run/openclaw-secrets/openclaw-keys.json" },
        {}
      )
    ).rejects.toThrow(BrokerSyncError);

    expect(calls).toHaveLength(1);
  });

  it("throws a BrokerSyncError when the restart step fails", async () => {
    const dockerRunner: DockerRunner = async (args) => {
      if (args[0] === "cp") {
        return { code: 0, stdout: "", stderr: "" };
      }
      return { code: 1, stdout: "", stderr: "container not running" };
    };

    await expect(
      syncBrokerOpenClawKeys(
        { dockerRunner, brokerContainer: "opengroow-broker-1", brokerKeysFilePath: "/run/openclaw-secrets/openclaw-keys.json" },
        {}
      )
    ).rejects.toThrow(BrokerSyncError);
  });
});
