"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { OptionalPluginId } from "@/src/lib/optional-plugins";

const OptionalPluginsContext = createContext<readonly OptionalPluginId[]>([]);

export function OptionalPluginsProvider({
  plugins,
  children,
}: {
  plugins: readonly OptionalPluginId[];
  children: ReactNode;
}) {
  return <OptionalPluginsContext.Provider value={plugins}>{children}</OptionalPluginsContext.Provider>;
}

export function useOptionalPlugin(id: OptionalPluginId): boolean {
  return useContext(OptionalPluginsContext).includes(id);
}
