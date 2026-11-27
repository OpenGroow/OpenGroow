import { useSyncExternalStore } from "react";
import { beforeEach } from "vitest";

// A tiny `next/navigation` stand-in whose URL query follows `router.push`, so components keeping a tab in the URL
// (`useUrlTab`) re-render as in the app. The URL is reset before every test.
let search = "";
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};
const emit = () => listeners.forEach((listener) => listener());

beforeEach(() => {
  search = "";
  emit();
});

export function navigationMock(spies: { push?: (url: string) => void; replace?: (url: string) => void } = {}) {
  const go = (url: string) => {
    search = url.includes("?") ? url.slice(url.indexOf("?") + 1) : "";
    emit();
  };
  return {
    useRouter: () => ({
      push: (url: string) => {
        spies.push?.(url);
        go(url);
      },
      replace: (url: string) => {
        spies.replace?.(url);
        go(url);
      },
    }),
    usePathname: () => "/test",
    useSearchParams: () => new URLSearchParams(useSyncExternalStore(subscribe, () => search, () => search)),
  };
}
