import { notFound } from "next/navigation";

import { ChatThread } from "@/components/chat/chat-thread";
import { getCurrentOrganisation } from "@/lib/organisations/current-organisation";
import * as runService from "@/lib/runs/run-service";

export const dynamic = "force-dynamic";

export default async function ChatThreadPage({
  params,
}: PageProps<"/chat/[runId]">) {
  const { runId } = await params;
  const organisation = await getCurrentOrganisation();
  const run = await runService.getRun(organisation.id, runId);
  if (!run || run.agent.executionMode !== "CHAT") notFound();

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-baseline gap-2 px-6 py-4">
        <h1 className="text-sm font-medium text-foreground">
          {run.agent.name}
        </h1>
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
      <ChatThread
        runId={run.id}
        initialStatus={run.status}
        initialSteps={run.steps.map((step) => ({
          id: step.id,
          stepType: step.stepType,
          detail: step.detail,
          toolName: step.toolCall?.toolName ?? null,
          toolStatus: step.toolCall?.status ?? null,
          createdAt: step.createdAt,
        }))}
      />
    </div>
  );
}
