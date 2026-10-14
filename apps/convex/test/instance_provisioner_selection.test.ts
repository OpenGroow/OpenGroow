import { afterEach, beforeAll, describe, expect, it } from "vitest";

beforeAll(() => {
  process.env.OPENCLAW_CONTROL_URL = "http://control.test";
  process.env.OPENCLAW_CONTROL_KEY_ID = "k";
  process.env.OPENCLAW_CONTROL_SECRET = "s";
});

const { env } = await import("../env");
const { selectInstanceProvisioner } = await import("../instance_provisioning/index");
const { controlPlaneProvisioner } = await import("../instance_provisioning/control_plane");
const { localProvisioner } = await import("../instance_provisioning/local");

describe("instance provisioner selection", () => {
  afterEach(() => {
    delete process.env.INSTANCE_PROVISIONER;
    delete process.env.IS_SELF_HOST;
  });

  it("defaults to the remote control-plane provisioner", () => {
    expect(env.INSTANCE_PROVISIONER).toBe("control-plane");
    expect(selectInstanceProvisioner()).toBe(controlPlaneProvisioner);
  });

  it("is chosen explicitly by INSTANCE_PROVISIONER", () => {
    process.env.INSTANCE_PROVISIONER = "local";
    expect(selectInstanceProvisioner()).toBe(localProvisioner);
    process.env.INSTANCE_PROVISIONER = "control-plane";
    expect(selectInstanceProvisioner()).toBe(controlPlaneProvisioner);
  });

  it("IS_SELF_HOST does not override INSTANCE_PROVISIONER", () => {
    process.env.IS_SELF_HOST = "1";
    process.env.INSTANCE_PROVISIONER = "control-plane";
    expect(selectInstanceProvisioner()).toBe(controlPlaneProvisioner);
  });

  it("ignores IS_SELF_HOST when INSTANCE_PROVISIONER is unset", () => {
    process.env.IS_SELF_HOST = "1";
    expect(selectInstanceProvisioner()).toBe(controlPlaneProvisioner);
  });

  it("rejects an unknown provisioner name", () => {
    process.env.INSTANCE_PROVISIONER = "mystery";
    expect(() => env.INSTANCE_PROVISIONER).toThrow(/INSTANCE_PROVISIONER/);
  });
});
