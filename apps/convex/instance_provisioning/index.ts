"use node";

import { controlPlaneProvisioner } from "./control_plane.js";
import { localProvisioner } from "./local.js";
import type { InstanceProvisioner } from "./types.js";
import { env } from "../env.js";

// Single composition point. The provisioner is chosen by explicit
// configuration (`INSTANCE_PROVISIONER`, see env.ts): "control-plane" talks to
// a remote service over the HMAC-signed API documented in
// docs/CONTROL_PLANE.md; "local" drives apps/openclaw-local-control. Both
// read the same OPENCLAW_CONTROL_{URL,KEY_ID,SECRET} variables, so a hosted
// deployment is configured by environment variables only.
//
// Evaluated per call (not at import) so the choice always reflects the
// current environment. IS_SELF_HOST does not select the provisioner; it only
// drives the trust rules (outbound URL checks, scope reservation, MCP URL
// overrides) elsewhere.
export function selectInstanceProvisioner(): InstanceProvisioner {
  return env.INSTANCE_PROVISIONER === "local"
    ? localProvisioner
    : controlPlaneProvisioner;
}

export const instanceProvisioner: InstanceProvisioner = {
  createInstance: (ctx, args) => selectInstanceProvisioner().createInstance(ctx, args),
  removeInstance: (ctx, args) => selectInstanceProvisioner().removeInstance(ctx, args),
  list: (ctx, args) => selectInstanceProvisioner().list(ctx, args),
  logs: (ctx, args) => selectInstanceProvisioner().logs(ctx, args),
  status: (ctx, args) => selectInstanceProvisioner().status(ctx, args),
  rollout: (ctx, args) => selectInstanceProvisioner().rollout(ctx, args),
};

export type {
  CreateInstanceArgs,
  InstanceProvisionResult,
  InstanceProvisioner,
} from "./types.js";
