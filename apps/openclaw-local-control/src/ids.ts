import { randomBytes, randomUUID } from "node:crypto";

// Matches the existing `local-<uuid>` job-id convention (see issue #303's
// Implementation Decisions) so that Convex-side identification stays
// consistent between the control-plane and local-multi backends.
export function generateInstanceId(): string {
  return `local-${randomUUID()}`;
}

export type InstanceCredentials = {
  keyId: string;
  secret: string;
  gatewayToken: string;
};

// Same generation scheme every local instance's credentials use:
// openclaw-<4 random bytes hex> key id, 32 random bytes hex secret/token.
export function generateCredentials(): InstanceCredentials {
  return {
    keyId: `openclaw-${randomBytes(4).toString("hex")}`,
    secret: randomBytes(32).toString("hex"),
    gatewayToken: randomBytes(32).toString("hex")
  };
}
