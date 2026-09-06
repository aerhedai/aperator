"use client";

import { OrganizationSwitcher, UserButton, useAuth } from "@clerk/nextjs";
import {
  Activity,
  Bot,
  BookText,
  CheckCircle2,
  LayoutGrid,
  Settings as SettingsIcon,
  Table2,
  Workflow,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

const LINKS = [
  { href: "/dashboard", label: "Overview", icon: LayoutGrid },
  { href: "/workflows", label: "Workflows", icon: Workflow },
  { href: "/agents", label: "Agents", icon: Bot },
  { href: "/runs", label: "Runs", icon: Activity },
  { href: "/catalog", label: "Catalog", icon: Table2 },
  { href: "/knowledge", label: "Knowledge", icon: BookText },
  { href: "/approvals", label: "Approvals", icon: CheckCircle2 },
];

export function Sidebar({ pendingApprovals }: { pendingApprovals: number }) {
  const pathname = usePathname();
  // <SignedIn> was removed in this Clerk major version ("Core 3") — check
  // auth state via the hook instead (same approach the old top nav used).
  const { isSignedIn } = useAuth();

  return (
    <aside className="flex h-screen w-60 shrink-0 flex-col border-r border-border p-3">
      <div className="mb-4 flex items-center gap-2 px-1 py-1">
        <span className="text-sm font-semibold tracking-tight">Aperator</span>
      </div>

      {isSignedIn && (
        <div className="mb-4 rounded-md border border-border px-2 py-1.5">
          <OrganizationSwitcher
            afterSelectOrganizationUrl="/dashboard"
            appearance={{
              elements: {
                organizationSwitcherTrigger: "w-full justify-between px-1",
              },
            }}
          />
        </div>
      )}

      <nav className="flex flex-col gap-0.5">
        {LINKS.map((link) => {
          const active = pathname.startsWith(link.href);
          const Icon = link.icon;
          const badge =
            link.href === "/approvals" && pendingApprovals > 0
              ? pendingApprovals
              : null;
          return (
            <Link
              key={link.href}
              href={link.href}
              className={cn(
                "flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors",
                active
                  ? "bg-app-accent-soft text-app-accent-soft-foreground"
                  : "text-muted-foreground hover:bg-secondary hover:text-foreground",
              )}
            >
              <Icon className="size-4 shrink-0" />
              {link.label}
              {badge !== null && (
                <span className="ml-auto rounded-full bg-warning/20 px-1.5 py-0.5 text-xs font-semibold tabular-nums text-warning">
                  {badge}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      <div className="flex-1" />

      <div className="flex flex-col gap-0.5 border-t border-border pt-2">
        <Link
          href="/settings"
          className={cn(
            "flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors",
            pathname.startsWith("/settings")
              ? "bg-app-accent-soft text-app-accent-soft-foreground"
              : "text-muted-foreground hover:bg-secondary hover:text-foreground",
          )}
        >
          <SettingsIcon className="size-4 shrink-0" />
          Settings
        </Link>
        {isSignedIn && (
          <div className="flex items-center gap-2.5 rounded-md px-2 py-1.5">
            <UserButton />
            <span className="text-sm text-muted-foreground">Account</span>
          </div>
        )}
      </div>
    </aside>
  );
}
