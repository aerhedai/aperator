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
      {/* The one place page margin is set for every (shell) route — no
          individual page should add its own left/right padding on top of
          this. "The page" is this box: everything between the sidebar and
          the right edge of the screen — centering happens relative to
          *this* box, never the full viewport (the sidebar is never part
          of the calculation). px-* is symmetric, so the base margin is
          equal by construction; clamp(1.25rem, 3vw, 4rem) makes it
          adaptive too, from a snug 20px floor up to a 64px ceiling. */}
      <main className="min-w-0 flex-1 overflow-y-auto px-[clamp(1.25rem,3vw,4rem)] py-6">
        {/* Content stops growing past max-w-7xl and centers in whatever
            room is left — on a wide monitor that extra room becomes
            bigger equal margins either side, not wider-and-wider content.
            mx-auto only ever centers within this <main>, so it can never
            drift toward the sidebar or the far edge of the screen. */}
        <div className="mx-auto h-full w-full max-w-7xl">{children}</div>
      </main>
    </div>
  );
}
