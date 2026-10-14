"use client";

import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { useSession } from "@/src/lib/auth-client";

export function useAuthenticatedInstances<T>() {
  const { data: session } = useSession();
  return useQuery(api.instances.list, session?.user ? {} : "skip") as T[] | undefined;
}
