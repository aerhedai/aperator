"use client";

import {
  Activity,
  Bot,
  BookText,
  CheckCircle2,
  ChevronDown,
  LayoutGrid,
  ListTodo,
  MessageSquare,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Search,
  Table2,
  Workflow,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useSyncExternalStore } from "react";

import { AccountMenu } from "@/components/layout/account-menu";
import type { RunStatus } from "@/lib/generated/prisma/client";
import { cn } from "@/lib/utils";

const LINKS = [
  { href: "/dashboard", label: "Home", icon: LayoutGrid },
  { href: "/chat", label: "Chat", icon: MessageSquare },
  { href: "/tasks", label: "Tasks", icon: ListTodo },
  { href: "/workflows", label: "Workflows", icon: Workflow },
  { href: "/agents", label: "Agents", icon: Bot },
  { href: "/runs", label: "Runs", icon: Activity },
  { href: "/catalog", label: "Catalog", icon: Table2 },
  { href: "/knowledge", label: "Knowledge", icon: BookText },
  { href: "/approvals", label: "Approvals", icon: CheckCircle2 },
];

const COLLAPSE_STORAGE_KEY = "aperator-sidebar-collapsed";

// Reading localStorage safely across server and client render passes needs
// useSyncExternalStore, not a mount effect that calls setState: the server
// has no localStorage, so it always renders "expanded" (getServerSnapshot),
// and React reconciles the real client value in for us right after
// hydration — no manual synchronization step, so no hydration mismatch and
// no synchronous setState-in-effect (same hydration-mismatch class already
// hit and fixed once on this branch, in the locale-dependent time
// formatting in components/chat/message-list.tsx).
function subscribeToCollapseStorage(onStoreChange: () => void) {
  window.addEventListener("storage", onStoreChange);
  return () => window.removeEventListener("storage", onStoreChange);
}

function getStoredCollapsed() {
  return localStorage.getItem(COLLAPSE_STORAGE_KEY) === "true";
}

function getServerCollapsed() {
  return false;
}

export interface SidebarChatThread {
  id: string;
  input: string;
  status: RunStatus;
  createdAt: Date;
}

// The single global nav for every (shell) route — replaces the old
// TopBar (deleted) plus the (app)-only Sidebar (docs/sidebar-nav-redesign-design.md).
// Collapse state is a local UI preference (localStorage) only, never
// sent to the server.
export function Sidebar({
  pendingApprovals,
  chatThreads,
}: {
  pendingApprovals: number;
  chatThreads: SidebarChatThread[];
}) {
  const pathname = usePathname();
  const storedCollapsed = useSyncExternalStore(
    subscribeToCollapseStorage,
    getStoredCollapsed,
    getServerCollapsed,
  );
  // A click overrides the stored value for the rest of this session; it
  // also writes straight through to localStorage so the next full page
  // load starts from the new preference. Writing directly in the handler
  // (rather than in an effect keyed on state) means there's no synchronous
  // setState-in-effect either.
  const [collapsedOverride, setCollapsedOverride] = useState<boolean | null>(
    null,
  );
  const collapsed = collapsedOverride ?? storedCollapsed;
  const [chatsExpanded, setChatsExpanded] = useState(true);

  function setCollapsed(next: boolean) {
    setCollapsedOverride(next);
    localStorage.setItem(COLLAPSE_STORAGE_KEY, String(next));
  }

  return (
    <aside
      className={cn(
        "flex h-full shrink-0 flex-col gap-4 overflow-hidden border-r border-sidebar-border bg-sidebar p-3 text-sidebar-foreground transition-[width] duration-200 ease-in-out",
        collapsed ? "w-16 items-center" : "w-60",
      )}
    >
      <div
        className={cn("flex items-center gap-2", collapsed && "flex-col gap-3")}
      >
        <img src="/icon.png" alt="Aperator" className="size-7 shrink-0" />
        {!collapsed && (
          <>
            <span className="text-sm font-semibold whitespace-nowrap">
              Aperator
            </span>
            <div className="ml-auto flex items-center gap-0.5">
              <button
                type="button"
                title="Search — coming soon"
                aria-label="Search"
                className="rounded-md p-1.5 text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
              >
                <Search className="size-4" />
              </button>
              <button
                type="button"
                onClick={() => setCollapsed(true)}
                aria-label="Collapse sidebar"
                className="rounded-md p-1.5 text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
              >
                <PanelLeftClose className="size-4" />
              </button>
            </div>
          </>
        )}
        {collapsed && (
          <button
            type="button"
            onClick={() => setCollapsed(false)}
            aria-label="Expand sidebar"
            className="rounded-md p-1.5 text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          >
            <PanelLeftOpen className="size-4" />
          </button>
        )}
      </div>

      <div
        className={cn(
          "grid w-full shrink-0 transition-[grid-template-rows] duration-200 ease-in-out",
          collapsed ? "grid-rows-[0fr]" : "grid-rows-[1fr]",
        )}
      >
        <div className="overflow-hidden">
          {/* Fixed width, independent of the animating parent: without it,
              this content has no icon-only form to shrink to, so as the
              sidebar narrows it would visibly reflow/wrap word-by-word
              instead of just sliding out of view. A quick opacity fade
              (shorter than the width/height transitions) hides it well
              before that clipping becomes noticeable. */}
          <div
            className={cn(
              "flex w-52 flex-col gap-1.5 transition-opacity duration-100 ease-in-out",
              collapsed ? "opacity-0" : "opacity-100",
            )}
          >
            <div className="flex items-center justify-between px-1">
              <span className="text-xs font-medium text-sidebar-foreground/70">
                Spaces
              </span>
              <button
                type="button"
                title="Add a space — coming soon"
                aria-label="Add a space"
                className="rounded-md p-1 text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
              >
                <Plus className="size-3.5" />
              </button>
            </div>
            <button
              type="button"
              title="Coming soon"
              className="flex items-center gap-2 rounded-md border border-dashed border-sidebar-border px-2.5 py-2 text-left text-xs text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent"
            >
              <Plus className="size-3.5 shrink-0" />
              Add a new workspace
            </button>
          </div>
        </div>
      </div>

      <div className="h-px w-full shrink-0 bg-sidebar-border" />

      <nav
        className={cn(
          "flex w-full flex-col gap-0.5",
          collapsed && "items-center",
        )}
      >
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
              title={collapsed ? link.label : undefined}
              className={cn(
                "flex items-center gap-2.5 rounded-md py-1.5 text-sm font-medium transition-colors",
                collapsed ? "size-8 justify-center px-0" : "px-2.5",
                active
                  ? "bg-app-accent-soft text-app-accent-soft-foreground"
                  : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
              )}
            >
              <Icon className="size-4 shrink-0" />
              <span
                className={cn(
                  "overflow-hidden whitespace-nowrap transition-[max-width,opacity] duration-200 ease-in-out",
                  collapsed ? "max-w-0 opacity-0" : "max-w-40 opacity-100",
                )}
              >
                {link.label}
              </span>
              {badge !== null && (
                <span
                  className={cn(
                    "ml-auto overflow-hidden rounded-full bg-warning/20 text-xs font-semibold tabular-nums text-warning transition-[max-width,opacity] duration-200 ease-in-out",
                    collapsed
                      ? "max-w-0 opacity-0"
                      : "max-w-8 px-1.5 py-0.5 opacity-100",
                  )}
                >
                  {badge}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      <div className="h-px w-full shrink-0 bg-sidebar-border" />

      <div
        className={cn(
          "grid w-full min-h-0 flex-1 transition-[grid-template-rows] duration-200 ease-in-out",
          collapsed ? "grid-rows-[0fr]" : "grid-rows-[1fr]",
        )}
      >
        <div className="flex min-h-0 flex-col overflow-hidden">
          {/* Same fixed-width + fast-fade treatment as the Spaces block
              above: a chat thread's title has no icon-only form, so it
              must disappear via opacity rather than reflow as the
              sidebar narrows. */}
          <div
            className={cn(
              "flex min-h-0 w-52 flex-1 flex-col gap-1.5 transition-opacity duration-100 ease-in-out",
              collapsed ? "opacity-0" : "opacity-100",
            )}
          >
            <button
              type="button"
              onClick={() => setChatsExpanded((expanded) => !expanded)}
              className="flex items-center justify-between px-1 text-xs font-medium text-sidebar-foreground/70"
            >
              Chats
              <ChevronDown
                className={cn(
                  "size-3.5 transition-transform",
                  !chatsExpanded && "-rotate-90",
                )}
              />
            </button>
            {chatsExpanded && (
              <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto">
                {chatThreads.length === 0 ? (
                  <p className="px-2.5 py-1 text-xs text-sidebar-foreground/70">
                    No chats yet.
                  </p>
                ) : (
                  chatThreads.map((thread) => {
                    const active = pathname === `/chat/${thread.id}`;
                    return (
                      <Link
                        key={thread.id}
                        href={`/chat/${thread.id}`}
                        className={cn(
                          "truncate rounded-md px-2.5 py-1.5 text-xs transition-colors",
                          active
                            ? "bg-app-accent-soft text-app-accent-soft-foreground"
                            : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                        )}
                      >
                        {thread.input}
                      </Link>
                    );
                  })
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      <div
        className={cn(
          "w-full shrink-0 border-t border-sidebar-border pt-2",
          collapsed && "flex justify-center",
        )}
      >
        <AccountMenu collapsed={collapsed} />
      </div>
    </aside>
  );
}
