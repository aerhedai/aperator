import Link from "next/link";

import { Card, CardContent } from "@/components/ui/card";
import * as approvalService from "@/lib/approvals/approval-service";
import { getCurrentOrganisation } from "@/lib/organisations/current-organisation";

export const dynamic = "force-dynamic";

export default async function ApprovalsPage() {
  const organisation = await getCurrentOrganisation();
  const approvals = await approvalService.listPendingApprovals(organisation.id);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 p-6">
      <h1 className="text-xl font-semibold">Approvals</h1>

      {approvals.length === 0 ? (
        <p className="text-sm text-muted-foreground">No pending approvals.</p>
      ) : (
        <div className="flex flex-col gap-3">
          {approvals.map((approval) => (
            <Link key={approval.id} href={`/runs/${approval.agentRunId}`}>
              <Card className="transition-colors hover:border-primary/40">
                <CardContent className="flex items-center justify-between py-4">
                  <div className="flex flex-col gap-1">
                    <span className="font-medium">
                      {approval.requestedAction}
                    </span>
                    <span className="text-sm text-muted-foreground">
                      {approval.reason}
                    </span>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {approval.requestedAt.toLocaleString("en-GB")}
                  </span>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
