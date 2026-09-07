"use client";

import { useState } from "react";
import { Check, Copy, CornerUpLeft, SmilePlus } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { ChatRunStepView } from "@/app/(shell)/chat/actions";
import { TOOL_REGISTRY } from "@/lib/mcp/tool-registry";

const TOOL_LABELS: Record<string, string> = Object.fromEntries(
  TOOL_REGISTRY.map((tool) => [tool.name, tool.label]),
);

function formatTime(date: Date) {
  return new Date(date).toLocaleTimeString("en-GB", {
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * A single turn of real conversation (as opposed to a system event like a
 * tool call). No bubble chrome — alignment alone tells you who spoke, the
 * way the reference design does. Reply/react are shown for visual parity
 * with the reference but aren't wired to anything yet; copy is real.
 */
function TurnMessage({
  align,
  text,
  timestamp,
}: {
  align: "start" | "end";
  text: string;
  timestamp: Date;
}) {
  const [copied, setCopied] = useState(false);
  const isEnd = align === "end";

  async function handleCopy() {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div
      className={cn(
        "group flex flex-col gap-1.5",
        isEnd ? "items-end" : "items-start",
      )}
    >
      <p
        className={cn(
          "max-w-[85%] text-[15px] leading-relaxed whitespace-pre-wrap text-foreground",
          isEnd && "text-right",
        )}
      >
        {text}
      </p>
      <div
        className={cn(
          "flex items-center gap-3 text-xs text-muted-foreground",
          isEnd && "flex-row-reverse",
        )}
      >
        <div
          className={cn(
            "flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100",
            isEnd && "flex-row-reverse",
          )}
        >
          <button
            type="button"
            aria-label="Reply"
            className="rounded-md p-1 hover:bg-muted hover:text-foreground"
          >
            <CornerUpLeft className="size-3.5" />
          </button>
          <button
            type="button"
            aria-label={copied ? "Copied" : "Copy"}
            onClick={() => void handleCopy()}
            className="rounded-md p-1 hover:bg-muted hover:text-foreground"
          >
            {copied ? (
              <Check className="size-3.5" />
            ) : (
              <Copy className="size-3.5" />
            )}
          </button>
          <button
            type="button"
            aria-label="React"
            className="rounded-md p-1 hover:bg-muted hover:text-foreground"
          >
            <SmilePlus className="size-3.5" />
          </button>
        </div>
        <span>{formatTime(timestamp)}</span>
      </div>
    </div>
  );
}

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
    <div className="flex flex-col gap-5">
      {steps.map((step) => {
        switch (step.stepType) {
          case "INPUT_RECEIVED":
            return (
              <TurnMessage
                key={step.id}
                align="end"
                text={step.detail ?? ""}
                timestamp={step.createdAt}
              />
            );

          case "AWAITING_INPUT":
          case "RUN_COMPLETED":
            return (
              <TurnMessage
                key={step.id}
                align="start"
                text={step.detail ?? ""}
                timestamp={step.createdAt}
              />
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
                <div className="max-w-[85%] rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning">
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
                <div className="max-w-[85%] rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {step.detail ?? "Something went wrong."}
                </div>
              </div>
            );

          case "RUN_CANCELLED":
            return (
              <p key={step.id} className="text-sm text-muted-foreground">
                Cancelled.
              </p>
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
    <div className={cn("flex items-center gap-1.5", className)}>
      <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground [animation-delay:-0.2s]" />
      <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground [animation-delay:-0.1s]" />
      <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground" />
    </div>
  );
}
