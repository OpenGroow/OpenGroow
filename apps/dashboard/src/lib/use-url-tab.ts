"use client";

import { useCallback } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

/**
 * A tab kept in the URL query (`?tab=recipes`) so the browser's Back button returns to the previous tab.
 * The fallback tab leaves the URL clean; an unknown value in the URL falls back too.
 */
export function useUrlTab<T extends string>(values: readonly T[], fallback: T, param = "tab"): [T, (tab: T) => void] {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const raw = searchParams?.get(param) ?? null;
  const tab = (values as readonly string[]).includes(raw ?? "") ? (raw as T) : fallback;

  const setTab = useCallback(
    (next: T) => {
      const query = new URLSearchParams(searchParams?.toString() ?? "");
      if (next === fallback) query.delete(param);
      else query.set(param, next);
      const qs = query.toString();
      router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [router, pathname, searchParams, fallback, param],
  );

  return [tab, setTab];
}
