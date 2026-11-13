"use client";

import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { FunctionReturnType } from "convex/server";

/** The data of an installed Publisher package (ADR-072): name, capabilities, channel options. No code. */
export type InstalledPublisher = FunctionReturnType<typeof api.publisher_packages.list>[number];

/** The installed Publisher packages; `undefined` while loading. */
export function useInstalledPublishers(): InstalledPublisher[] | undefined {
  return useQuery(api.publisher_packages.list, {});
}

/** The installed package providing `adapter`, if any. */
export function useInstalledPublisher(adapter: string | undefined): InstalledPublisher | undefined {
  const installed = useInstalledPublishers();
  return adapter ? installed?.find((p) => p.adapter === adapter) : undefined;
}
