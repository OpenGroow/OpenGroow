// Channel / content-kind capabilities (ADR-069 amendment, ADR-070). The data
// is shipped by each Publisher plugin; the pure reader lives in the SDK. This
// module only resolves a Publisher's adapter id to its plugin's data.
// Importable from Convex functions and from the dashboard.

import { capabilityIn, type Capability } from "@opengroow/publisher-sdk";
import { PUBLISHER_ADAPTER_IDS, pluginFor } from "./registry";

export { parseCapabilities, type Capability } from "@opengroow/publisher-sdk";

/** Capability of a channel's service for a Publishable kind. Unknown adapter, service or kind: `uncertain`. */
export function capabilityOf(adapterId: string, service: string | undefined, kind: string): Capability {
  return capabilityIn(PUBLISHER_ADAPTER_IDS.includes(adapterId) ? pluginFor(adapterId).capabilities : undefined, service, kind);
}
