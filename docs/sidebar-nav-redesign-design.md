# Design: Sidebar-Only Navigation and a Full-Panel Chat

Status: **proposed, not built.** Follows directly on the chat-thread visual
redesign (bubble-free messages, floating composer — see the `feat/chat-
symphony-redesign` branch), which this extends from the chat route to the
whole app shell.

---

## 1. The problem

Aperator currently has two separate pieces of navigation chrome:

- `TopBar` (`components/layout/top-bar.tsx`) — a full-width header with
  four destinations (Home, Chat, Templates, Docs), the Clerk organisation
  switcher, and the account button. Renders on every `(shell)` route.
- `Sidebar` (`components/layout/sidebar.tsx`) — a left rail with seven
  section links (Overview, Workflows, Agents, Runs, Catalog, Knowledge,
  Approvals) plus Settings. Renders only inside the `(app)` route group,
  i.e. only under Home — not on Chat, Templates, or Docs.

This splits navigation across two systems with different reach, wastes
vertical space to a header on every page, and — the concrete trigger for
this redesign — makes the chat screen feel like two different interfaces
stitched together: a boxy "start a chat" list view under the top bar, then
a visually distinct full-panel thread view once a message is sent.

The user's reference design (`symphony.png`) shows a single dark,
sidebar-led interface where chat fills the entire panel. This design
brings that structure to Aperator's own theme: one sidebar, always
present, and a chat route that never shows an intermediate "old-looking"
screen.

---

## 2. Layout architecture

`TopBar` is deleted. `Sidebar` becomes the single piece of navigation
chrome for the whole `(shell)` route group (Home, Chat, Workflows,
Agents, Runs, Catalog, Knowledge, Approvals, Templates, Docs) — not just
`(app)`.

Concretely:

- `components/layout/top-bar.tsx` — deleted.
- `app/(shell)/(app)/layout.tsx` — deleted. Its only job (rendering
  `Sidebar` + a flex wrapper around `(app)`'s own children) moves up a
  level; `(app)` is a route group (parenthesized folder), so it needs no
  layout of its own once its parent provides one.
- `app/(shell)/layout.tsx` — rewritten to do what `(app)/layout.tsx` used
  to do, but for the whole shell:

  ```tsx
  export default async function ShellLayout({ children }) {
    const organisation = await getCurrentOrganisation();
    const counts = await dashboardService.getDashboardCounts(organisation.id);
    const agent = await chatAgentService.findChatAgent(organisation.id);
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

**Side effect worth naming:** every `(shell)` route now resolves an
organisation before rendering (`getCurrentOrganisation()` redirects to
`/sign-in` or `/select-organisation` otherwise), same as `(app)` routes
already do. `/docs` (currently a static placeholder with no auth check of
its own) and `/templates` (which already checks) both pick this up.
Nothing in either page needs auth logic removed — this only adds a gate
at the layout level, which is strictly tighter, not looser. Both routes
stay reachable by direct URL (per the "drop from primary nav" decision);
they just now require a resolved organisation to render, consistent with
the rest of the app.

---

## 3. Sidebar composition

`components/layout/sidebar.tsx` is rewritten. Top to bottom, expanded
state:

1. **Header.** `app/icon.png` (already a transparent PNG — confirmed, no
   new asset needed) + "Aperator" wordmark. A search icon button (visual
   only — no search primitive exists in the platform yet) and the
   collapse toggle sit on the same row, given more breathing room than
   the old cramped top-bar logo treatment.
2. **Spaces.** Label + a "+" icon button. Both are visual-only for this
   design — there is no `Space` primitive or database model. Empty state
   (always, for now): a dashed/muted placeholder row with a plus icon and
   "Add a new workspace", itself a button. Clicking either affordance is
   a no-op for now (or, if trivial, a disabled-with-tooltip state — an
   implementation choice, not a design one). This is chrome scaffolding
   for a feature that doesn't exist yet; CLAUDE.md §3 is explicit that a
   vertical or a new concept shouldn't be built until there's a real
   primitive behind it, so no `Space` table, no API route.
3. Divider (hairline, matching the `border-border` convention already
   used throughout).
4. **Nav list.** Home, Chat, Workflows, Agents, Runs, Catalog, Knowledge,
   Approvals — same active-state and badge styling as today's `Sidebar`,
   with `Chat` added (it wasn't in the old sidebar, since chat lived only
   in the top bar before). Templates and Docs are dropped from this list
   per the "drop from primary nav" decision — still reachable by URL, not
   linked here.
5. Divider.
6. **Chats.** Label + an up/down chevron collapsing the section (client
   component state, default expanded, not persisted — low cost either
   way). Below it, `chatThreads` rendered as compact rows (truncated
   input text, active-state highlight when the current route is that
   thread's `/chat/[runId]`). Empty state: muted "No chats yet." This
   reuses the exact data `app/(shell)/chat/page.tsx` already fetches
   today (`chatAgentService.findChatAgent` +
   `runService.listRunsForAgent`) — moved to the layout so it's available
   sidebar-wide, not just on the chat route.
7. Spacer (`flex-1`), pushing the footer down.
8. **Footer** (pinned, not part of the scrolling nav region): Clerk's
   `OrganizationSwitcher`, `UserButton`, and a small settings gear icon
   linking to `/settings` — replacing the old sidebar's dedicated
   "Settings" nav row and the top bar's org/account controls. No
   plan/billing indicator (explicitly out of scope for this pass).

**Collapsed state** (icon-only rail, toggled from the header): shows only
the logo mark and the nav list's icons (tooltips on hover for labels).
Spaces and Chats sections are hidden entirely — collapsed means minimal,
not scrollable. The footer stays visible but icon-only (org
switcher/account/settings still reachable with the sidebar collapsed).
Collapse state is a `useState` in the client `Sidebar` component,
persisted to `localStorage` so it survives a refresh (cheap, avoids an
annoying reset every reload) but is not stored server-side — purely a
local UI preference, not organisation data.

---

## 4. Chat flow

`app/(shell)/chat/page.tsx` (no thread yet) stops rendering the inline
list of past threads — that list now lives permanently in the sidebar's
Chats section, so keeping a second copy in the main panel would be
redundant and is exactly the "small section, not the whole panel" problem
being fixed. The page becomes: a light empty-state prompt (plain,
active-voice copy — not filler) plus the same floating pill composer
already used in the thread view, filling the full panel height, matching
the reference's proportions.

Sending the first message still goes through the existing
`startChatAction` Server Action (`app/(shell)/chat/actions.ts`), which
already creates the run and calls `redirect(\`/chat/${runId}\`)`. A Server
Action `redirect()` is already a client-side transition in the App
Router — there is no full page reload to fix here, only the visual
mismatch of the old list-page being fixed by removing it. Opening a
thread from the sidebar's Chats list navigates straight to
`/chat/[runId]` and continues that thread; there is no separate "new vs.
continue" branch to build beyond routes that already exist.

**One thing to verify, not pre-solve:** whether the sidebar's Chats list
(rendered by the `(shell)` layout, a Server Component) reflects a
brand-new thread immediately after `startChatAction`'s redirect, or lags
by one navigation due to the App Router's layout caching. If testing
shows staleness, the fix is a single `revalidatePath("/chat")` call added
to `startChatAction` (and `sendChatMessageAction`, if a message ever
needs to reorder the list) — noted here so it isn't a surprise mid-
implementation, not designed preemptively since it may not be needed.

---

## 5. What this does not change

- No new database model, migration, or primitive. `Space` is UI-only.
- No new tools, policies, or agent behavior.
- `ChatThread` and `MessageList` (already redesigned) are unchanged.
- Color palette is unchanged — everything still derives from the existing
  theme tokens (`--background`, `--foreground`, `--muted-foreground`,
  `--border`, `--card`, `--app-accent*`), so light and dark mode both
  keep working without new values.
- `/templates` and `/docs` keep their existing page content; only their
  entry point (top bar link) is removed.

---

## 6. Files touched

```
components/layout/top-bar.tsx        deleted
components/layout/sidebar.tsx        rewritten
app/(shell)/(app)/layout.tsx         deleted
app/(shell)/layout.tsx               rewritten (sidebar + data fetching moved up)
app/(shell)/chat/page.tsx            inline thread list removed, empty-state composer
app/(shell)/chat/actions.ts          possibly: revalidatePath, if testing shows staleness
```

No other route's page content changes — only the chrome wrapping it.

---

## 7. Testing

No new business logic to unit test. Verification is:

- `pnpm run typecheck`, `pnpm run lint`, `pnpm test` (existing suite must
  stay green — this touches layout, not runtime/policy/tool code).
- `next build`, confirming every existing route still builds.
- Manual/browser verification (via the same temporary unauthenticated
  preview-route technique used for the chat-thread redesign, since local
  dev has no Clerk seed-account shortcut): expanded and collapsed
  sidebar, light and dark mode, active-state highlighting on each nav
  item and the current chat thread, the Spaces empty state, the Chats
  section collapse toggle, and the `/chat` empty-state composer through
  to a real thread.
- Confirm `/docs` and `/templates` still render correctly now that they
  sit behind the layout's organisation check.
