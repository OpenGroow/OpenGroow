"use client";

import Image from "next/image";
import Link from "next/link";
import { signOut } from "@/src/lib/auth-client";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type RootNavItem = {
  href: string;
  label: string;
  icon: () => React.JSX.Element;
};

const ROOT_NAV_ITEMS: RootNavItem[] = [
  { href: "/", label: "Projects", icon: AppGridIcon },
];

export function DashboardRootSidebar({
  activeHref,
}: {
  activeHref: string;
}) {
  return (
    <aside className="flex flex-col gap-5 border-b border-sidebar-border bg-sidebar px-4 pb-4 pt-8 text-sidebar-foreground xl:min-h-screen xl:border-b-0 xl:border-r xl:px-5 xl:pb-6 xl:pt-13">
      <div className="flex flex-1 flex-col gap-6 pt-4">
        <div className="flex items-center gap-4">
          <Image src="/opengroow-logo.png" alt="OpenGroow" width={40} height={40} className="size-10 shrink-0" priority />
          <div className="text-base font-semibold leading-tight tracking-tight text-sidebar-foreground">
            OpenGroow
          </div>
        </div>

        <nav className="grid gap-1" aria-label="Dashboard">
          {ROOT_NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = item.href === activeHref;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "relative flex h-10 items-center gap-3 rounded-lg px-3 text-base font-medium transition-colors [&_svg]:size-5 [&_svg]:shrink-0",
                  isActive
                    ? "bg-sidebar-accent text-sidebar-accent-foreground before:absolute before:inset-y-2 before:left-0 before:w-0.5 before:rounded-full before:bg-sidebar-primary"
                    : "text-sidebar-foreground/70 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
                )}
              >
                <Icon />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>
      </div>

      <Button
        type="button"
        variant="ghost"
        className="mt-auto justify-start text-sidebar-foreground/70 hover:text-sidebar-foreground [&_svg]:size-4"
        onClick={() =>
          void signOut({
            fetchOptions: {
              onSuccess: () => {
                window.location.href = "/";
              },
            },
          })
        }
      >
        <SignOutIcon />
        <span>Sign Out</span>
      </Button>
    </aside>
  );
}

function AppGridIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="4" y="5" width="7" height="6" rx="1.5" fill="currentColor" />
      <rect x="13" y="5" width="7" height="6" rx="1.5" fill="currentColor" opacity="0.7" />
      <rect x="4" y="13" width="7" height="6" rx="1.5" fill="currentColor" opacity="0.75" />
      <rect x="13" y="13" width="7" height="6" rx="1.5" fill="currentColor" opacity="0.45" />
    </svg>
  );
}

function SignOutIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M10 6H6.75A1.75 1.75 0 0 0 5 7.75v8.5C5 17.216 5.784 18 6.75 18H10M14 8l4 4-4 4M18 12H9"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
