import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { ChatRunStepView } from "@/app/(shell)/chat/actions";
import { TOOL_REGISTRY } from "@/lib/mcp/tool-registry";

const TOOL_LABELS: Record<string, string> = Object.fromEntries(
  TOOL_REGISTRY.map((tool) => [tool.name, tool.label]),
);

/**
 * The entire transcript — messages and tool-use activity alike — is built
 * from RunStep rows, not AgentRun.messages. RunSteps are what runLoop
 * writes incrementally as it works, so this is also what makes live
 * progress possible: the same rows a finished thread renders from are
 * exactly what a poll mid-turn already sees, just fewer of them so far.
 *
 * AGENT_DECISION steps are skipped: they either carry no content (a tool
 * call is coming next) or, on a final text reply, duplicate what
 * AWAITING_INPUT/RUN_COMPLETED already show — never a distinct message of
 * its own.
 */
export function MessageList({ steps }: { steps: ChatRunStepView[] }) {
  return (
    <div className="flex flex-col gap-3">
      {steps.map((step) => {
        switch (step.stepType) {
          case "INPUT_RECEIVED":
            return (
              <div key={step.id} className="flex justify-end">
                <div className="max-w-[75%] rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground whitespace-pre-wrap">
                  {step.detail}
                </div>
              </div>
            );

          case "AWAITING_INPUT":
          case "RUN_COMPLETED":
            return (
              <div key={step.id} className="flex justify-start">
                <div className="max-w-[75%] rounded-lg bg-secondary px-3 py-2 text-sm whitespace-pre-wrap">
                  {step.detail}
                </div>
              </div>
            );

          case "TOOL_CALL":
            return (
              <div key={step.id} className="flex justify-start">
                <Badge
                  variant={
                    step.toolStatus === "FAILED" ? "destructive" : "outline"
                  }
                  className="font-normal"
                >
                  {step.toolStatus === "FAILED" ? "Failed: " : "Used "}
                  {TOOL_LABELS[step.toolName ?? ""] ?? step.toolName}
                </Badge>
              </div>
            );

          case "APPROVAL_REQUESTED":
            return (
              <div key={step.id} className="flex justify-start">
                <div className="max-w-[75%] rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning">
                  Waiting for approval — see{" "}
                  <a href="/approvals" className="underline">
                    Approvals
                  </a>
                  .
                </div>
              </div>
            );

          case "RUN_FAILED":
            return (
              <div key={step.id} className="flex justify-start">
                <div className="max-w-[75%] rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {step.detail ?? "Something went wrong."}
                </div>
              </div>
            );

          case "RUN_CANCELLED":
            return (
              <div key={step.id} className="flex justify-start">
                <div className="max-w-[75%] rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">
                  Cancelled.
                </div>
              </div>
            );

          default:
            return null;
        }
      })}
    </div>
  );
}

export function ThinkingIndicator({ className }: { className?: string }) {
  return (
    <div className={cn("flex justify-start", className)}>
      <div className="flex items-center gap-1 rounded-lg bg-secondary px-3 py-2">
        <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground [animation-delay:-0.2s]" />
        <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground [animation-delay:-0.1s]" />
        <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground" />
      </div>
    </div>
  );
}
