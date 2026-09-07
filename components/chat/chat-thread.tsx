"use client";

import { useEffect, useRef, useState } from "react";

import { Mic, Plus } from "lucide-react";

import {
  getChatRunStateAction,
  sendChatMessageAction,
  type ChatRunStateView,
  type ChatRunStepView,
} from "@/app/(shell)/chat/actions";
import { MessageList, ThinkingIndicator } from "@/components/chat/message-list";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { RunStatus } from "@/lib/generated/prisma/client";

const POLL_INTERVAL_MS = 1500;
// Any status where it isn't the human's turn yet — a message send or an
// approval decision elsewhere could still change this run, so it's worth
// polling for. WAITING_FOR_INPUT, COMPLETED, FAILED and CANCELLED are all
// "it's quiet, nothing to watch right now."
const ACTIVE_STATUSES: RunStatus[] = [
  "PENDING",
  "RUNNING",
  "WAITING_FOR_APPROVAL",
];

export function ChatThread({
  runId,
  initialStatus,
  initialSteps,
}: {
  runId: string;
  initialStatus: RunStatus;
  initialSteps: ChatRunStepView[];
}) {
  const [status, setStatus] = useState<RunStatus>(initialStatus);
  const [steps, setSteps] = useState<ChatRunStepView[]>(initialSteps);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const active = ACTIVE_STATUSES.includes(status);

  useEffect(() => {
    if (!active) return;
    const interval = setInterval(() => {
      getChatRunStateAction(runId).then((state: ChatRunStateView) => {
        setStatus(state.status);
        setSteps(state.steps);
      });
    }, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [active, runId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [steps.length, active]);

  async function handleSend() {
    const message = draft.trim();
    if (!message || active || sending) return;

    setDraft("");
    setSending(true);
    setStatus("RUNNING");
    try {
      await sendChatMessageAction(runId, message);
      const state = await getChatRunStateAction(runId);
      setStatus(state.status);
      setSteps(state.steps);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 overflow-y-auto px-6 py-6">
        <div className="mx-auto max-w-2xl">
          <MessageList steps={steps} />
          {active && <ThinkingIndicator className="mt-4" />}
          <div ref={bottomRef} />
        </div>
      </div>

      <div className="px-6 pb-6">
        <div className="mx-auto flex max-w-2xl flex-col gap-1 rounded-3xl border border-border bg-card p-3 shadow-sm">
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void handleSend();
              }
            }}
            placeholder={
              active ? "Waiting for a reply…" : "Message the assistant…"
            }
            disabled={active}
            className="min-h-10 resize-none border-none bg-transparent px-1 shadow-none focus-visible:ring-0"
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
            <Button
              onClick={() => void handleSend()}
              disabled={active || !draft.trim() || sending}
              className="rounded-full px-4"
            >
              Send
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
