"use client";

import { useEffect, useRef, useState } from "react";

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
      <div className="flex-1 overflow-y-auto px-6 py-4">
        <MessageList steps={steps} />
        {active && <ThinkingIndicator className="mt-3" />}
        <div ref={bottomRef} />
      </div>

      <div className="flex items-end gap-2 border-t border-border p-4">
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
          className="min-h-10 flex-1"
        />
        <Button
          onClick={() => void handleSend()}
          disabled={active || !draft.trim() || sending}
        >
          Send
        </Button>
      </div>
    </div>
  );
}
