"use node";

import type { AnalyticsAdapter } from "@opengroow/publisher-sdk";
import type { ActionCtx } from "../_generated/server.js";

/**
 * The Analytics Adapter linked by default to a Publication that went through
 * the Publisher `publisherAdapter`, or null when that Publisher brings none
 * (the Publication is then unmeasured). An adapter ships in a hub package
 * (ADR-078); hub packaging and its loading come with the Postiz adapter.
 */
export async function loadAnalyticsAdapter(_ctx: ActionCtx, _publisherAdapter: string): Promise<AnalyticsAdapter | null> {
  return null;
}
