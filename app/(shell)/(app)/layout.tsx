import type { ReactNode } from "react";

import { Sidebar } from "@/components/layout/sidebar";
import * as dashboardService from "@/lib/dashboard/dashboard-service";
import { getCurrentOrganisation } from "@/lib/organisations/current-organisation";

export default async function AppLayout({ children }: { children: ReactNode }) {
  // Every page under this layout is guaranteed a resolved organisation —
  // getCurrentOrganisation() redirects to /sign-in or /select-organisation
  // otherwise, both of which live outside this layout (app/sign-in,
  // app/select-organisation), so there's no risk of redirecting a page
  // back into itself.
  const organisation = await getCurrentOrganisation();
  const counts = await dashboardService.getDashboardCounts(organisation.id);

  return (
    <div className="flex h-full">
      <Sidebar pendingApprovals={counts.waitingForApproval} />
      <main className="min-w-0 flex-1 overflow-y-auto">{children}</main>
    </div>
  );
}
