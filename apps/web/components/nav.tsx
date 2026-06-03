"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Building2,
  CheckCircle2,
  CalendarCheck,
  FileSearch,
  FolderGit2,
  GitPullRequest,
  LayoutDashboard,
  ListChecks,
  PlayCircle,
  ScrollText,
  ServerCog,
  Settings,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";

export type AppNavItem = {
  label: string;
  href: "/workspaces" | `/dashboard${string}`;
  icon: LucideIcon;
};

export const APP_NAV_ITEMS: AppNavItem[] = [
  { label: "Overview", href: "/dashboard", icon: LayoutDashboard },
  { label: "Workspaces", href: "/workspaces", icon: Building2 },
  { label: "Repositories", href: "/dashboard/repositories", icon: FolderGit2 },
  { label: "Findings", href: "/dashboard/findings", icon: FileSearch },
  {
    label: "Task Recommendations",
    href: "/dashboard/task-recommendations",
    icon: ShieldCheck,
  },
  { label: "Tasks", href: "/dashboard/tasks", icon: ListChecks },
  { label: "Setup PRs", href: "/dashboard/setup-prs", icon: GitPullRequest },
  { label: "Weekly Review", href: "/dashboard/weekly-review", icon: CalendarCheck },
  { label: "Runs", href: "/dashboard/runs", icon: PlayCircle },
  { label: "Approvals", href: "/dashboard/approvals", icon: CheckCircle2 },
  { label: "Pull Requests", href: "/dashboard/pull-requests", icon: GitPullRequest },
  { label: "Runners", href: "/dashboard/runners", icon: ServerCog },
  { label: "Audit Log", href: "/dashboard/audit-log", icon: ScrollText },
  { label: "Settings", href: "/dashboard/settings", icon: Settings },
];

const isActiveItem = (pathname: string, href: AppNavItem["href"]) => {
  if (href === "/dashboard") {
    return pathname === href;
  }

  return pathname === href || pathname.startsWith(`${href}/`);
};

export function AppNav() {
  const pathname = usePathname() ?? "/dashboard";

  return (
    <>
      <aside className="hidden min-h-screen border-r border-border bg-card px-5 py-6 lg:block">
        <Link
          className="block rounded-md px-2 py-1 outline-none focus-visible:ring-2 focus-visible:ring-ring"
          href="/dashboard"
        >
          <span className="text-xs font-semibold uppercase tracking-normal text-muted-foreground">
            Control Plane
          </span>
          <span className="mt-1 block text-xl font-semibold text-foreground">Cortex</span>
        </Link>

        <nav aria-label="Primary" className="mt-8 flex flex-col gap-1">
          {APP_NAV_ITEMS.map((item) => {
            const active = isActiveItem(pathname, item.href);
            const Icon = item.icon;

            return (
              <Link
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex h-10 items-center gap-3 rounded-md px-3 text-sm font-medium text-muted-foreground outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
                  active
                    ? "bg-primary text-primary-foreground"
                    : "hover:bg-secondary hover:text-foreground",
                )}
                href={item.href}
                key={item.href}
              >
                <Icon aria-hidden="true" className="size-4" />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>
      </aside>

      <div className="border-b border-border bg-card px-4 py-3 lg:hidden">
        <div className="flex items-center justify-between gap-4">
          <Link
            className="text-base font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring"
            href="/dashboard"
          >
            Cortex
          </Link>
          <span className="text-xs font-medium text-muted-foreground">Control Plane</span>
        </div>
        <nav aria-label="Primary mobile" className="mt-3 flex gap-2 overflow-x-auto pb-1">
          {APP_NAV_ITEMS.map((item) => {
            const active = isActiveItem(pathname, item.href);
            const Icon = item.icon;

            return (
              <Link
                aria-current={active ? "page" : undefined}
                className={cn(
                  "inline-flex h-9 shrink-0 items-center gap-2 rounded-md border border-transparent px-3 text-sm font-medium text-muted-foreground outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
                  active
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-background hover:text-foreground",
                )}
                href={item.href}
                key={item.href}
              >
                <Icon aria-hidden="true" className="size-4" />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>
      </div>
    </>
  );
}
