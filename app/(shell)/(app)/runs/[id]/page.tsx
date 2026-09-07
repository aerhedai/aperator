import Link from "next/link";
import { notFound } from "next/navigation";

import {
  approveRunAction,
  rejectRunAction,
} from "@/app/(shell)/(app)/runs/[id]/actions";
import { RunStatusBadge } from "@/components/runs/run-status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import * as approvalService from "@/lib/approvals/approval-service";
import type { RunStepType } from "@/lib/generated/prisma/client";
import { getCurrentOrganisation } from "@/lib/organisations/current-organisation";
import * as runService from "@/lib/runs/run-service";

function isProposedEmail(
  value: unknown,
): value is { to: string; subject: string; body: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Record<string, unknown>).to === "string" &&
    typeof (value as Record<string, unknown>).subject === "string" &&
    typeof (value as Record<string, unknown>).body === "string"
  );
}

export const dynamic = "force-dynamic";

const STEP_LABELS: Record<RunStepType, string> = {
  INPUT_RECEIVED: "Input received",
  AGENT_DECISION: "Agent decision",
  TOOL_CALL: "Tool call",
  APPROVAL_REQUESTED: "Approval requested",
  APPROVAL_GRANTED: "Approval granted",
  RUN_COMPLETED: "Run completed",
  RUN_FAILED: "Run failed",
  RUN_CANCELLED: "Run cancelled",
};

function formatDuration(
  startedAt: Date | null,
  completedAt: Date | null,
): string | null {
  if (!startedAt || !completedAt) return null;
  const seconds = (completedAt.getTime() - startedAt.getTime()) / 1000;
  return `${seconds.toFixed(1)}s`;
}

export default async function RunDetailPage({
  params,
}: PageProps<"/runs/[id]">) {
  const { id } = await params;
  const organisation = await getCurrentOrganisation();
  const run = await runService.getRun(organisation.id, id);

  if (!run) {
    notFound();
  }

  const duration = formatDuration(run.startedAt, run.completedAt);
  const tokenTotals = run.steps.reduce(
    (totals, step) => ({
      prompt: totals.prompt + (step.promptTokens ?? 0),
      completion: totals.completion + (step.completionTokens ?? 0),
    }),
    { prompt: 0, completion: 0 },
  );
  const hasTokenUsage = tokenTotals.prompt > 0 || tokenTotals.completion > 0;
  const pendingApproval =
    run.status === "WAITING_FOR_APPROVAL"
      ? await approvalService.getPendingApprovalForRun(run.id)
      : null;
  const proposedEmail = isProposedEmail(pendingApproval?.proposedInput)
    ? pendingApproval.proposedInput
    : null;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 p-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-semibold">Run #{run.id.slice(-8)}</h1>
          <RunStatusBadge status={run.status} />
        </div>
        <Link
          href={`/agents/${run.agentId}`}
          className="text-sm font-medium text-primary hover:underline"
        >
          {run.agent.name}
        </Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Input
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm whitespace-pre-wrap">{run.input}</p>
        </CardContent>
      </Card>

      {run.status === "WAITING_FOR_APPROVAL" && (
        <Card className="border-warning/40">
          <CardHeader>
            <CardTitle className="text-sm font-medium text-warning">
              Approval needed
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {proposedEmail ? (
              <div className="flex flex-col gap-2 rounded-md border border-border bg-muted/40 p-3 text-sm">
                <p className="text-muted-foreground">
                  This email has not been sent — nothing goes to the customer
                  until this is approved.
                </p>
                <p>
                  <span className="text-muted-foreground">To: </span>
                  <span className="font-mono">{proposedEmail.to}</span>
                </p>
                <p>
                  <span className="text-muted-foreground">Subject: </span>
                  {proposedEmail.subject}
                </p>
                <p className="whitespace-pre-wrap border-t border-border pt-2">
                  {proposedEmail.body}
                </p>
              </div>
            ) : (
              pendingApproval && (
                <p className="text-sm text-muted-foreground">
                  {pendingApproval.reason}
                </p>
              )
            )}
            <div className="flex items-center gap-3">
              <form action={approveRunAction.bind(null, run.id)}>
                <Button type="submit">Approve</Button>
              </form>
              <form action={rejectRunAction.bind(null, run.id)}>
                <Button type="submit" variant="outline">
                  Reject
                </Button>
              </form>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Steps
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ol className="flex flex-col gap-3">
            {run.steps.map((step, index) => (
              <li key={step.id} className="flex gap-3 text-sm">
                <span className="text-muted-foreground tabular-nums">
                  {index + 1}.
                </span>
                <div className="flex flex-col gap-0.5">
                  <span className="font-medium">
                    {step.stepType === "TOOL_CALL" && step.toolCall
                      ? step.toolCall.toolName
                      : STEP_LABELS[step.stepType]}
                  </span>
                  {step.toolCall ? (
                    <span className="font-mono text-xs text-muted-foreground">
                      {step.toolCall.status === "SUCCESS"
                        ? `Result: ${JSON.stringify(step.toolCall.output)}`
                        : `Error: ${step.toolCall.error}`}
                    </span>
                  ) : (
                    step.detail && (
                      <span className="text-muted-foreground">
                        {step.detail}
                      </span>
                    )
                  )}
                  {step.promptTokens != null && (
                    <span className="text-xs text-muted-foreground">
                      {step.promptTokens} prompt + {step.completionTokens}{" "}
                      completion tokens
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>

      <div className="flex items-center gap-4 text-sm text-muted-foreground">
        {duration && <p>Completed in: {duration}</p>}
        {hasTokenUsage && (
          <p>
            Tokens used: {tokenTotals.prompt} prompt + {tokenTotals.completion}{" "}
            completion = {tokenTotals.prompt + tokenTotals.completion} total
          </p>
        )}
      </div>
    </div>
  );
}
