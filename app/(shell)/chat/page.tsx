import Link from "next/link";
import { Mic, Plus } from "lucide-react";

import { startChatAction } from "@/app/(shell)/chat/actions";
import { RunStatusBadge } from "@/components/runs/run-status-badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import * as chatAgentService from "@/lib/agents/chat-agent-service";
import { getCurrentOrganisation } from "@/lib/organisations/current-organisation";
import * as runService from "@/lib/runs/run-service";

export const dynamic = "force-dynamic";

export default async function ChatPage() {
  const organisation = await getCurrentOrganisation();
  const agent = await chatAgentService.findChatAgent(organisation.id);
  const threads = agent
    ? await runService.listRunsForAgent(organisation.id, agent.id)
    : [];

  return (
    <div className="mx-auto flex h-full max-w-2xl flex-col gap-6 px-6 py-6">
      <div className="flex items-baseline justify-between">
        <h1 className="text-sm font-medium text-foreground">Chat</h1>
        <Link
          href="/chat/settings"
          className="text-xs text-muted-foreground hover:text-foreground hover:underline"
        >
          Assistant settings
        </Link>
      </div>

      <form
        action={startChatAction}
        className="flex flex-col gap-1 rounded-3xl border border-border bg-card p-3 shadow-sm"
      >
        <Textarea
          name="message"
          placeholder="Ask the assistant anything, or ask it to use one of the agents it's been granted…"
          className="min-h-24 resize-none border-none bg-transparent px-1 shadow-none focus-visible:ring-0"
          required
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
          <Button type="submit" className="rounded-full px-4">
            Start chat
          </Button>
        </div>
      </form>

      {threads.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No conversations yet — start one above.
        </p>
      ) : (
        <div className="flex flex-col">
          {threads.map((run) => (
            <Link
              key={run.id}
              href={`/chat/${run.id}`}
              className="flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-muted"
            >
              <p className="line-clamp-1 flex-1 text-sm text-foreground">
                {run.input}
              </p>
              <span className="shrink-0 text-xs text-muted-foreground">
                {run.createdAt.toLocaleString("en-GB")}
              </span>
              <RunStatusBadge status={run.status} />
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
