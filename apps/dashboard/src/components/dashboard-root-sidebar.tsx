"use client";

import Link from "next/link";
import { signOut } from "@/src/lib/auth-client";
import { cn } from "@/lib/utils";

type RootNavItem = {
  href: string;
  label: string;
  icon: () => React.JSX.Element;
};

const ROOT_NAV_ITEMS: RootNavItem[] = [
  { href: "/", label: "Projects", icon: AppGridIcon },
  { href: "/admin", label: "Admin", icon: AdminPanelIcon },
];

export function DashboardRootSidebar({
  activeHref,
  workspaceSubtitle,
  workspaceTitle,
}: {
  activeHref: string;
  workspaceSubtitle: string;
  workspaceTitle: string;
}) {
  return (
    <aside className="flex flex-col gap-5 bg-[#fbfcfa] px-4 pb-4 pt-8 shadow-[inset_0_-1px_0_rgba(192,200,195,0.24)] xl:min-h-screen xl:px-7 xl:pb-7 xl:pt-[var(--dashboard-home-top-offset)] xl:shadow-[inset_-1px_0_0_rgba(192,200,195,0.24)]">
      <div className="flex flex-1 flex-col gap-6 pt-4">
        <div className="flex items-center gap-4">
          <div className="flex size-12 items-center justify-center rounded-2xl bg-[linear-gradient(135deg,var(--dashboard-primary),var(--dashboard-primary-container))] text-[var(--dashboard-on-primary)] shadow-[0_12px_26px_rgba(0,38,27,0.16)] [&_svg]:size-5">
            <WorkspaceMark />
          </div>
          <div>
            <div className="font-[var(--font-dashboard-display)] text-xl leading-[1.05] tracking-[-0.04em] text-[var(--dashboard-ink)]">
              {workspaceTitle}
            </div>
            <div className="mt-1 text-[0.9375rem] text-[var(--dashboard-ink-soft)]">
              {workspaceSubtitle}
            </div>
          </div>
        </div>

        <nav className="grid gap-2" aria-label="Dashboard">
          {ROOT_NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = item.href === activeHref;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex min-h-14 items-center gap-3.5 rounded-[1.25rem] px-4 py-3 transition-[background-color,color,transform] duration-150 hover:-translate-y-px [&_svg]:size-5 [&_svg]:shrink-0",
                  isActive
                    ? "bg-[linear-gradient(135deg,rgba(188,237,215,0.92),rgba(214,236,226,0.88))] text-[var(--dashboard-primary)] shadow-[inset_0_0_0_1px_rgba(0,38,27,0.08)]"
                    : "text-[var(--dashboard-ink-muted)] hover:bg-[rgba(220,230,224,0.7)] hover:text-[var(--dashboard-ink)]",
                )}
              >
                <Icon />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>
      </div>

      <button
        type="button"
        className="mt-auto flex min-h-14 items-center gap-3.5 px-4 text-[var(--dashboard-ink-muted)] transition-[color,transform] duration-150 hover:translate-x-0.5 hover:text-[var(--dashboard-primary)] [&_svg]:size-5"
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
      </button>
    </aside>
  );
}

function WorkspaceMark() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="4.5" y="5.5" width="15" height="13" rx="2.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M8 9.5h8M8 13h5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
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

function AdminPanelIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M12 3.75 19 7.5v9L12 20.25 5 16.5v-9l7-3.75Zm0 4.25a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="12" r="1.8" fill="currentColor" />
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
