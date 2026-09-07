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
