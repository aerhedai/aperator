# Sidebar-Only Navigation and Full-Panel Chat Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the top bar + `(app)`-only sidebar split with a single global sidebar (logo/search/collapse header, a visual-only Spaces placeholder, the full nav list including Chat, a live Chats history section, and an org/account/settings footer), and make `/chat` a full-panel composer from the first paint instead of an inline thread-list page.

**Architecture:** Delete `TopBar` and the `(app)`-only layout; move sidebar rendering and its data-fetching (org, pending-approval count, chat thread list) up into `app/(shell)/layout.tsx` so every `(shell)` route gets the same nav. The redesigned `Sidebar` component owns its own collapse state (localStorage) and chat-history collapse state (in-memory). `/chat`'s inline thread list is deleted since the sidebar now shows it; the page becomes just the empty-state composer.

**Tech Stack:** Next.js App Router (Server Components for data fetching, one `"use client"` component for the sidebar's interactive state), Tailwind, lucide-react icons, Clerk (`OrganizationSwitcher`, `UserButton`), existing `cn` utility.

**Spec:** `docs/sidebar-nav-redesign-design.md`

## Global Constraints

- No new database model, migration, tool, or policy — Spaces is UI-only (spec §3, §5).
- No new color tokens — everything derives from existing `--background`/`--foreground`/`--muted-foreground`/`--border`/`--card`/`--app-accent*`/`--warning` tokens (spec §5).
- Search and "Add a space" are visual-only affordances for this pass (spec §3) — no backend, no new routes.
- Templates and Docs are dropped from the nav list but keep their existing page content and stay reachable by direct URL (spec §2, §5).
- No component-test harness exists in this repo (confirmed: no `*.test.tsx` files, no jsdom/testing-library in `vitest.config.ts`) — verification is `pnpm run typecheck` / `pnpm run lint` / `pnpm test` (the existing 477 business-logic tests must stay green) / `next build`, plus real browser verification.
- This repo has no seed-script auth shortcut (`README.md`): real browser verification against the dev server requires either the Clerk test-mode bypass (an email containing `+clerk_test` on this `sk_test_`/`pk_test_` instance always accepts verification code `424242`, no real inbox needed) or a temporary unauthenticated preview route (delete before committing) for pure visual/component checks that don't need real data.

---

## Task 1: Build the new Sidebar component

**Files:**

- Modify: `components/layout/sidebar.tsx` (full rewrite)

**Interfaces:**

- Produces: `Sidebar({ pendingApprovals: number, chatThreads: SidebarChatThread[] })` and the exported `SidebarChatThread` interface (`{ id: string; input: string; status: RunStatus; createdAt: Date }`) — Task 2 constructs and passes these props from real data.

This task builds and visually verifies the component in isolation, before it's wired into the real app shell (Task 2). Verification uses a temporary unauthenticated preview route with mock data, the same technique already used and proven earlier on this branch for the chat-thread redesign.

- [ ] **Step 1: Replace `components/layout/sidebar.tsx` entirely**

```tsx
"use client";

import { OrganizationSwitcher, UserButton } from "@clerk/nextjs";
import {
  Activity,
  Bot,
  BookText,
  CheckCircle2,
  ChevronDown,
  LayoutGrid,
  MessageSquare,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Search,
  Settings as SettingsIcon,
  Table2,
  Workflow,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import type { RunStatus } from "@/lib/generated/prisma/client";
import { cn } from "@/lib/utils";

const LINKS = [
  { href: "/dashboard", label: "Home", icon: LayoutGrid },
  { href: "/chat", label: "Chat", icon: MessageSquare },
  { href: "/workflows", label: "Workflows", icon: Workflow },
  { href: "/agents", label: "Agents", icon: Bot },
  { href: "/runs", label: "Runs", icon: Activity },
  { href: "/catalog", label: "Catalog", icon: Table2 },
  { href: "/knowledge", label: "Knowledge", icon: BookText },
  { href: "/approvals", label: "Approvals", icon: CheckCircle2 },
];

const COLLAPSE_STORAGE_KEY = "aperator-sidebar-collapsed";

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
  const [collapsed, setCollapsed] = useState(false);
  const [chatsExpanded, setChatsExpanded] = useState(true);

  // Read the stored preference after mount, never in useState's own
  // initializer — the server has no localStorage, so an initializer that
  // reads it would make the server-rendered markup (always "expanded")
  // disagree with the client's first paint. Same hydration-mismatch class
  // already hit and fixed once on this branch (locale-dependent time
  // formatting in components/chat/message-list.tsx).
  useEffect(() => {
    if (localStorage.getItem(COLLAPSE_STORAGE_KEY) === "true") {
      setCollapsed(true);
    }
  }, []);

  useEffect(() => {
    localStorage.setItem(COLLAPSE_STORAGE_KEY, String(collapsed));
  }, [collapsed]);

  return (
    <aside
      className={cn(
        "flex h-full shrink-0 flex-col gap-4 border-r border-border p-3",
        collapsed ? "w-16 items-center" : "w-60",
      )}
    >
      <div
        className={cn("flex items-center gap-2", collapsed && "flex-col gap-3")}
      >
        <img src="/icon.png" alt="Aperator" className="size-7 shrink-0" />
        {!collapsed && (
          <>
            <span className="text-sm font-semibold tracking-tight">
              Aperator
            </span>
            <div className="ml-auto flex items-center gap-0.5">
              <button
                type="button"
                title="Search — coming soon"
                aria-label="Search"
                className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <Search className="size-4" />
              </button>
              <button
                type="button"
                onClick={() => setCollapsed(true)}
                aria-label="Collapse sidebar"
                className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
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
            className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <PanelLeftOpen className="size-4" />
          </button>
        )}
      </div>

      {!collapsed && (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between px-1">
            <span className="text-xs font-medium text-muted-foreground">
              Spaces
            </span>
            <button
              type="button"
              title="Add a space — coming soon"
              aria-label="Add a space"
              className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <Plus className="size-3.5" />
            </button>
          </div>
          <button
            type="button"
            title="Coming soon"
            className="flex items-center gap-2 rounded-md border border-dashed border-border px-2.5 py-2 text-left text-xs text-muted-foreground transition-colors hover:bg-muted"
          >
            <Plus className="size-3.5 shrink-0" />
            Add a new workspace
          </button>
        </div>
      )}

      <div className="h-px shrink-0 bg-border" />

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
              title={collapsed ? link.label : undefined}
              className={cn(
                "flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors",
                collapsed && "justify-center px-0",
                active
                  ? "bg-app-accent-soft text-app-accent-soft-foreground"
                  : "text-muted-foreground hover:bg-secondary hover:text-foreground",
              )}
            >
              <Icon className="size-4 shrink-0" />
              {!collapsed && link.label}
              {!collapsed && badge !== null && (
                <span className="ml-auto rounded-full bg-warning/20 px-1.5 py-0.5 text-xs font-semibold tabular-nums text-warning">
                  {badge}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      {!collapsed && (
        <>
          <div className="h-px shrink-0 bg-border" />

          <div className="flex min-h-0 flex-1 flex-col gap-1.5">
            <button
              type="button"
              onClick={() => setChatsExpanded((expanded) => !expanded)}
              className="flex items-center justify-between px-1 text-xs font-medium text-muted-foreground"
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
              <div className="flex min-h-0 flex-col gap-0.5 overflow-y-auto">
                {chatThreads.length === 0 ? (
                  <p className="px-2.5 py-1 text-xs text-muted-foreground">
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
                            : "text-muted-foreground hover:bg-secondary hover:text-foreground",
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
        </>
      )}

      {collapsed && <div className="flex-1" />}

      <div
        className={cn(
          "flex shrink-0 items-center gap-1.5 border-t border-border pt-2",
          collapsed && "flex-col",
        )}
      >
        {!collapsed && (
          <OrganizationSwitcher afterSelectOrganizationUrl="/dashboard" />
        )}
        <UserButton />
        {!collapsed && (
          <Link
            href="/settings"
            aria-label="Settings"
            title="Settings"
            className={cn(
              "ml-auto rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
              pathname.startsWith("/settings") &&
                "bg-app-accent-soft text-app-accent-soft-foreground",
            )}
          >
            <SettingsIcon className="size-4" />
          </Link>
        )}
      </div>
    </aside>
  );
}
```

Note the deliberate scope cut in the collapsed-rail footer: `OrganizationSwitcher` and the Settings link are hidden when collapsed (Clerk's switcher has no compact icon-only mode without custom `appearance` theming, which is out of scope here) — only `UserButton` (already a small avatar) stays visible. This still satisfies the spec's "account reachable when collapsed," just not the org switcher specifically. Flag this to the user if it reads as a meaningful gap once seen live.

- [ ] **Step 2: Typecheck and lint**

Run: `pnpm run typecheck && pnpm run lint`
Expected: both clean. If `next typegen` complains about a stale route (from a previous session's temporary preview route), run `rm -rf .next` first.

- [ ] **Step 3: Visually verify in isolation via a temporary preview route**

Create `app/dev-preview-sidebar/page.tsx` (temporary, deleted in Step 5):

```tsx
import { Sidebar, type SidebarChatThread } from "@/components/layout/sidebar";

const mockThreads: SidebarChatThread[] = [
  {
    id: "1",
    input: "What's the status of the Acme quote?",
    status: "COMPLETED",
    createdAt: new Date(),
  },
  {
    id: "2",
    input: "Draft a follow-up email to the landlord about the repair request",
    status: "WAITING_FOR_INPUT",
    createdAt: new Date(),
  },
];

export default function DevPreviewSidebarPage() {
  return (
    <div className="flex h-screen">
      <Sidebar pendingApprovals={3} chatThreads={mockThreads} />
      <main className="flex-1 bg-background" />
    </div>
  );
}
```

Start the dev server (`pnpm dev`, needs `.env.local` copied in if this is a fresh worktree — see Task 2's testing step for the full local-dev setup), navigate to `/dev-preview-sidebar` in a real browser (Playwright or otherwise — no auth needed, this route doesn't call `getCurrentOrganisation()`), and check:

- Expanded: logo + wordmark + search + collapse button in the header, Spaces empty-state placeholder, all 8 nav links in order with icons, the Approvals badge showing "3", the Chats section showing both mock threads, footer with org switcher + account + settings icon.
- Click the collapse button: rail shrinks to icon-only, Spaces/Chats sections disappear, nav icons stay clickable with `title` tooltips, footer shows only the account avatar.
- Click expand again: state returns, and confirm collapse survives a full page reload (localStorage persistence).
- Toggle the Chats section's chevron: list hides/shows.
- Switch to dark mode (`document.documentElement.classList.add('dark')` via browser devtools/evaluate) and re-check all of the above — no new colors, but confirm nothing is illegible.

- [ ] **Step 4: Fix anything that looks wrong**

Common likely issues to check for specifically: icon centering in the collapsed rail (the `items-center` on `<aside>` plus `justify-center` on each link may need adjusting if icons look off-center), and whether the Chats section's `overflow-y-auto` actually scrolls instead of pushing the footer off-screen when there are many mock threads (test with 15+ mock entries if the first check looks fine with only 2).

- [ ] **Step 5: Delete the temporary preview route**

```bash
rm -rf app/dev-preview-sidebar
```

- [ ] **Step 6: Commit**

```bash
git add components/layout/sidebar.tsx
git commit -m "feat: rebuild the sidebar as the app's single global nav"
```

---

## Task 2: Wire the new Sidebar into the app shell

**Files:**

- Delete: `components/layout/top-bar.tsx`
- Delete: `app/(shell)/(app)/layout.tsx`
- Modify: `app/(shell)/layout.tsx` (full rewrite)

**Interfaces:**

- Consumes: `Sidebar` and `SidebarChatThread` from Task 1 (`@/components/layout/sidebar`); `dashboardService.getDashboardCounts(organisationId)` returning `{ waitingForApproval: number, ... }`; `chatAgentService.findChatAgent(organisationId)` returning `Agent | null`; `runService.listRunsForAgent(organisationId, agentId)` returning rows structurally compatible with `SidebarChatThread`; `getCurrentOrganisation()` (redirects to `/sign-in` or `/select-organisation` if unauthenticated).
- Produces: every `(shell)` route now renders behind one shared layout that resolves the organisation and always shows the sidebar — no other task needs new exports from this one.

- [ ] **Step 1: Delete the top bar**

```bash
rm components/layout/top-bar.tsx
```

- [ ] **Step 2: Delete the `(app)`-only layout**

```bash
rm "app/(shell)/(app)/layout.tsx"
```

- [ ] **Step 3: Replace `app/(shell)/layout.tsx` entirely**

```tsx
import type { ReactNode } from "react";

import { Sidebar } from "@/components/layout/sidebar";
import * as chatAgentService from "@/lib/agents/chat-agent-service";
import * as dashboardService from "@/lib/dashboard/dashboard-service";
import { getCurrentOrganisation } from "@/lib/organisations/current-organisation";
import * as runService from "@/lib/runs/run-service";

// The single global nav for every (shell) route (Home, Chat, Workflows,
// Agents, Runs, Catalog, Knowledge, Approvals, Templates, Docs) — see
// docs/sidebar-nav-redesign-design.md. This is where the old (app)-only
// layout's data fetching (app/(shell)/(app)/layout.tsx, now deleted)
// moved to, plus the chat thread list the sidebar's Chats section needs.
export default async function ShellLayout({
  children,
}: {
  children: ReactNode;
}) {
  const organisation = await getCurrentOrganisation();
  const [counts, agent] = await Promise.all([
    dashboardService.getDashboardCounts(organisation.id),
    chatAgentService.findChatAgent(organisation.id),
  ]);
  const chatThreads = agent
    ? await runService.listRunsForAgent(organisation.id, agent.id)
    : [];

  return (
    <div className="flex h-screen">
      <Sidebar
        pendingApprovals={counts.waitingForApproval}
        chatThreads={chatThreads}
      />
      <main className="min-w-0 flex-1 overflow-y-auto">{children}</main>
    </div>
  );
}
```

- [ ] **Step 4: Typecheck, lint, and build**

Run: `rm -rf .next && pnpm run typecheck && pnpm run lint && pnpm exec next build`
Expected: all clean. The build's route list should still show every existing `(shell)` route (`/dashboard`, `/chat`, `/chat/[runId]`, `/workflows`, `/agents`, `/runs`, `/catalog`, `/knowledge`, `/approvals`, `/settings`, `/templates`, `/docs`, etc.) — confirm none silently disappeared from the deleted `(app)/layout.tsx`.

- [ ] **Step 5: Real end-to-end browser verification**

This step needs a genuine authenticated session — the sidebar now gates every route on `getCurrentOrganisation()`, so the unauthenticated-preview-route trick from Task 1 won't exercise the real thing. Use Clerk's test-mode bypass (this project's Clerk keys are `sk_test_`/`pk_test_`, confirmed in `.env.local`):

1. Copy `.env.local` from the main checkout into this worktree if it isn't already there (`cp /Users/rohan/agensync/.env.local .env.local` — gitignored, never commit it).
2. Start the dev server: `pnpm dev`. Note the port (3000 if free, else the next one Next.js picks).
3. Navigate to `/sign-up`. Sign up with an email containing `+clerk_test` (e.g. `sidebar-check+clerk_test@example.com`). If asked for a verification code, use `424242`. Set any password if asked.
4. If redirected to `/select-organisation` or an org-creation prompt, create a throwaway organisation (any name) — this is a fresh Clerk dev-instance account, so there is no existing org to select.
5. Once past onboarding, confirm the sidebar renders on `/dashboard`: header (logo/wordmark/search/collapse), Spaces placeholder, all 8 nav links, Chats section (should show "No chats yet." — this is a brand-new org), footer with org switcher + account + settings icon.
6. Click through every nav link (Workflows, Agents, Runs, Catalog, Knowledge, Approvals) and confirm: the sidebar persists (same instance, not remounted — collapse state if toggled stays put), and the correct link highlights active while the others don't.
7. Navigate directly to `/templates` and `/docs` by typing the URL — confirm both still render their existing content (a template list and the placeholder text respectively) now that they sit behind the shared layout's organisation check, and confirm neither is linked from the sidebar (per the "drop from primary nav" decision).
8. Confirm `/dev-preview-sidebar` no longer exists (404) — verifies Task 1's cleanup step actually landed.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: make the sidebar the global nav for every shell route"
```

---

## Task 3: Redesign the chat pages — full-panel empty state and settings affordance

**Files:**

- Modify: `app/(shell)/chat/page.tsx` (full rewrite)
- Modify: `app/(shell)/chat/[runId]/page.tsx:17-33` (header row)

**Interfaces:**

- Consumes: `startChatAction` from `@/app/(shell)/chat/actions` (unchanged — already creates a run and redirects to `/chat/[runId]`); `ChatThread` from `@/components/chat/chat-thread` (unchanged).
- Produces: nothing new consumed by other tasks — this is the last UI change.

`app/(shell)/chat/page.tsx` currently fetches and renders an inline list of past threads below the composer. That list is now redundant with the sidebar's Chats section (Tasks 1–2), and is exactly the "small section, not the whole panel" problem the redesign is fixing — so it's deleted here, not kept as a duplicate. The page also loses its old "Chat" title (redundant with the sidebar's own "Chat" nav label) but needs to keep access to `/chat/settings` (the chat **agent's** own settings — instructions/model/tools — a different, still-needed page, not the same as the app-wide `/settings` the sidebar footer's gear icon now covers).

- [ ] **Step 1: Replace `app/(shell)/chat/page.tsx` entirely**

```tsx
import { Mic, Plus, Settings } from "lucide-react";
import Link from "next/link";

import { startChatAction } from "@/app/(shell)/chat/actions";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

export const dynamic = "force-dynamic";

export default function ChatPage() {
  return (
    <div className="mx-auto flex h-full max-w-2xl flex-col px-6 py-6">
      <div className="flex justify-end">
        <Link
          href="/chat/settings"
          aria-label="Assistant settings"
          title="Assistant settings"
          className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <Settings className="size-4" />
        </Link>
      </div>

      <div className="flex flex-1 flex-col items-center justify-center gap-4">
        <p className="text-sm text-muted-foreground">What can I help with?</p>

        <form
          action={startChatAction}
          className="flex w-full flex-col gap-1 rounded-3xl border border-border bg-card p-3 shadow-sm"
        >
          <Textarea
            name="message"
            placeholder="Ask the assistant anything, or ask it to use one of the agents it's been granted…"
            className="min-h-24 resize-none border-none bg-transparent px-1 shadow-none focus-visible:ring-0"
            required
          />
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-0.5">
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                disabled
                aria-label="Attach a file"
                className="text-muted-foreground"
              >
                <Plus className="size-4" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                disabled
                aria-label="Use voice"
                className="text-muted-foreground"
              >
                <Mic className="size-4" />
              </Button>
            </div>
            <Button type="submit" className="rounded-full px-4">
              Start chat
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
```

Note this drops the `chatAgentService`/`runService`/`getCurrentOrganisation`/`RunStatusBadge` imports the old version had — none are needed once the inline list is gone, and the page no longer needs to be `async`.

- [ ] **Step 2: Update the thread page's header to add the same settings affordance**

In `app/(shell)/chat/[runId]/page.tsx`, add the `Link` and `Settings` imports (matching this codebase's existing import ordering — third-party packages first, then `@/` imports alphabetically) and change the header `<div>`:

```tsx
import { Settings } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ChatThread } from "@/components/chat/chat-thread";
import { getCurrentOrganisation } from "@/lib/organisations/current-organisation";
import * as runService from "@/lib/runs/run-service";
```

Replace the existing header block:

```tsx
<div className="flex items-baseline gap-2 px-6 py-4">
  <h1 className="text-sm font-medium text-foreground">{run.agent.name}</h1>
  <span className="text-xs text-muted-foreground">
    {run.createdAt.toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
    })}
    ,{" "}
    {run.createdAt.toLocaleTimeString("en-GB", {
      hour: "numeric",
      minute: "2-digit",
    })}
  </span>
</div>
```

with:

```tsx
<div className="flex items-center justify-between px-6 py-4">
  <div className="flex items-baseline gap-2">
    <h1 className="text-sm font-medium text-foreground">{run.agent.name}</h1>
    <span className="text-xs text-muted-foreground">
      {run.createdAt.toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
      })}
      ,{" "}
      {run.createdAt.toLocaleTimeString("en-GB", {
        hour: "numeric",
        minute: "2-digit",
      })}
    </span>
  </div>
  <Link
    href="/chat/settings"
    aria-label="Assistant settings"
    title="Assistant settings"
    className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
  >
    <Settings className="size-4" />
  </Link>
</div>
```

- [ ] **Step 3: Typecheck and lint**

Run: `pnpm run typecheck && pnpm run lint`
Expected: both clean.

- [ ] **Step 4: Real end-to-end browser verification, continuing the Task 2 session**

Using the same authenticated session from Task 2 Step 5 (or repeating the `+clerk_test` sign-up if starting fresh):

1. Navigate to `/chat`. Confirm: no inline thread list, just the settings icon top-right and the centered "What can I help with?" composer filling the panel — no old-looking screen before you type anything.
2. Type a message and send it (click "Start chat", or however the form submits). Confirm you land on `/chat/[runId]` with the message and the assistant's reply visible (same redesigned bubble-free thread view from the earlier chat-symphony-redesign work).
3. **This is the spec's flagged check:** without a manual refresh, look at the sidebar's Chats section — does the new thread appear? If yes, no further action needed, skip Task 4. If it's missing or stale, proceed to Task 4.
4. Click the new thread's entry in the sidebar (once visible). Confirm it navigates to the same `/chat/[runId]` and shows the same conversation — continuing, not duplicating, the thread.
5. Send a second message from within that thread. Confirm it appends to the same conversation.
6. Click "Chat" in the sidebar's main nav list. Confirm it goes to `/chat` and shows the empty-state composer again (a fresh "new chat" entry point), not the thread you were just in.

- [ ] **Step 5: Commit**

```bash
git add "app/(shell)/chat/page.tsx" "app/(shell)/chat/[runId]/page.tsx"
git commit -m "feat: make /chat a full-panel composer instead of a thread-list page"
```

---

## Task 4: Fix sidebar chat-history staleness (only if Task 3 Step 4.3 found it stale)

Skip this task entirely if Task 3's verification showed the new thread appearing in the sidebar immediately.

**Files:**

- Modify: `app/(shell)/chat/actions.ts:32-50` (`startChatAction`)

**Interfaces:**

- Consumes: `revalidatePath` from `next/cache`.
- Produces: nothing new — this only affects cache freshness of data Task 2 already wired up.

- [ ] **Step 1: Add cache revalidation to `startChatAction`**

In `app/(shell)/chat/actions.ts`, add the import:

```tsx
import { revalidatePath } from "next/cache";
```

And call it right before the `redirect` in `startChatAction`:

```tsx
export async function startChatAction(formData: FormData): Promise<void> {
  const organisation = await getCurrentOrganisation();
  const message = String(formData.get("message") ?? "").trim();
  if (!message) {
    redirect("/chat");
  }

  const agent = await chatAgentService.getOrCreateChatAgent(organisation.id);
  const runId = await beginNewChatRun(agent, message);

  after(() =>
    runChatTurn(organisation.id, runId, agent, [
      { role: "system", content: agent.instructions },
      { role: "user", content: message },
    ]),
  );

  revalidatePath("/chat", "layout");
  redirect(`/chat/${runId}`);
}
```

The `"layout"` type revalidates `app/(shell)/layout.tsx` itself (not just the `/chat` page segment), since that's where the Chats list is actually fetched.

- [ ] **Step 2: Typecheck**

Run: `pnpm run typecheck`
Expected: clean.

- [ ] **Step 3: Re-run the exact check that failed**

Repeat Task 3 Step 4 (points 1–3) in the same authenticated session. Confirm the new thread now appears in the sidebar immediately after creation, with no manual refresh.

- [ ] **Step 4: Commit**

```bash
git add "app/(shell)/chat/actions.ts"
git commit -m "fix: revalidate the chat layout so new threads appear in the sidebar immediately"
```

---

## Task 5: Full regression sweep and PR update

**Files:** none (verification only)

- [ ] **Step 1: Full test suite**

Run: `pnpm test`
Expected: all 477 existing tests still pass (this redesign touches no business logic, so a new failure means something broke, not that a test needs updating).

- [ ] **Step 2: Full lint, typecheck, and production build**

Run: `rm -rf .next && pnpm run typecheck && pnpm run lint && pnpm exec next build`
Expected: all clean, full route list intact.

- [ ] **Step 3: Dark mode sweep**

In the same authenticated browser session, toggle dark mode (however the app exposes it, or `document.documentElement.classList.add('dark')` via devtools if there's no in-app toggle yet) and re-check: sidebar (expanded and collapsed), the `/chat` empty state, and an existing thread. Confirm nothing is illegible and no new colors were introduced (everything should already be covered by existing tokens per the Global Constraints).

- [ ] **Step 4: Clean up local artifacts**

```bash
rm -rf .next .env.local
```

(`.env.local` was only needed for local browser verification — never commit it; confirm `git status` shows it absent.)

- [ ] **Step 5: Push and update the PR**

Fetch the current PR body first so the new section is appended, not overwritten:

```bash
git push
gh pr view 103 --json body -q .body > /tmp/pr-103-body.md
```

Append this section to the end of `/tmp/pr-103-body.md`:

```markdown
## Sidebar-only navigation and full-panel chat (follow-up)

- Replaces the top bar + `(app)`-only sidebar split with one global sidebar (`components/layout/sidebar.tsx`) covering every `(shell)` route: a logo/wordmark/search/collapse header, a visual-only "Spaces" placeholder (no new backend — see `docs/sidebar-nav-redesign-design.md`), the full nav list (Home, Chat, Workflows, Agents, Runs, Catalog, Knowledge, Approvals), a live "Chats" history section, and an org-switcher/account/settings footer. Collapses to an icon-only rail, persisted via `localStorage`.
- `TopBar` and the `(app)`-only layout are deleted; `app/(shell)/layout.tsx` now does the organisation/data resolution for the whole shell, including the chat thread list the sidebar's Chats section reads.
- `/chat` no longer shows an inline thread list (now redundant with the sidebar) — it's a full-panel empty-state composer from first paint, matching the reference design's proportions instead of a boxy list-then-thread transition.
- Templates and Docs are dropped from the nav per an explicit decision (`docs/sidebar-nav-redesign-design.md` §2) — both routes are unchanged and still reachable by direct URL.
- No new colors, no new primitives, no new database model.

### Test plan (this follow-up)

- [x] `pnpm run typecheck` / `pnpm run lint` / `pnpm test` (477/477) / `next build` — all clean
- [x] Real authenticated browser verification via Clerk's test-mode bypass (`+clerk_test` email, code `424242` — no seed-script shortcut exists in this repo): sidebar renders on every route, correct active-state highlighting, collapse/expand persists across reload, Chats section reflects real threads, `/templates` and `/docs` still render behind the new shared auth gate
- [x] New-thread-appears-in-sidebar-immediately check (the one item the design spec flagged as "verify, don't pre-solve")
```

```bash
gh pr edit 103 --body-file /tmp/pr-103-body.md
rm /tmp/pr-103-body.md
```
