"use client";

import { OrganizationSwitcher, UserButton, useAuth } from "@clerk/nextjs";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

const DESTINATIONS = [
  // "Home" covers everything under the (app) group — dashboard, workflows,
  // agents, runs, catalog, knowledge, approvals, settings — so it's active
  // whenever the path isn't explicitly one of the other two.
  {
    href: "/dashboard",
    label: "Home",
    match: (path: string) =>
      !path.startsWith("/templates") && !path.startsWith("/docs"),
  },
  {
    href: "/templates",
    label: "Templates",
    match: (path: string) => path.startsWith("/templates"),
  },
  {
    href: "/docs",
    label: "Docs",
    match: (path: string) => path.startsWith("/docs"),
  },
];

export function TopBar() {
  const pathname = usePathname();
  // <SignedIn> was removed in this Clerk major version ("Core 3") — check
  // auth state via the hook instead.
  const { isSignedIn } = useAuth();

  return (
    <header className="flex h-14 shrink-0 items-center gap-6 border-b border-border px-4">
      <span className="text-sm font-semibold tracking-tight">Aperator</span>

      <nav className="flex items-center gap-1">
        {DESTINATIONS.map((destination) => (
          <Link
            key={destination.href}
            href={destination.href}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
              destination.match(pathname)
                ? "bg-secondary text-foreground"
                : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground",
            )}
          >
            {destination.label}
          </Link>
        ))}
      </nav>

      {isSignedIn && (
        <div className="ml-auto flex items-center gap-3">
          <OrganizationSwitcher afterSelectOrganizationUrl="/dashboard" />
          <UserButton />
        </div>
      )}
    </header>
  );
}
