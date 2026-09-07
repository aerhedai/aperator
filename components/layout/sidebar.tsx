"use client";

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

// The org switcher and account menu live in the top bar now
// (app/(shell)/layout.tsx) — they're relevant regardless of whether
// you're under Home, Templates, or Docs, not just this sidebar's own
// section list.
export function Sidebar({ pendingApprovals }: { pendingApprovals: number }) {
  const pathname = usePathname();

  return (
    <aside className="flex h-full w-60 shrink-0 flex-col gap-0.5 border-r border-border p-3">
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
    </aside>
  );
}
