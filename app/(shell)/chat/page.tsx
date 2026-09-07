import Link from "next/link";

import { startChatAction } from "@/app/(shell)/chat/actions";
import { RunStatusBadge } from "@/components/runs/run-status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
    <div className="mx-auto flex h-full max-w-2xl flex-col gap-6 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Chat</h1>
        <Button
          variant="outline"
          nativeButton={false}
          render={<Link href="/chat/settings" />}
        >
          Assistant settings
        </Button>
      </div>

      <form action={startChatAction} className="flex flex-col gap-2">
        <Textarea
          name="message"
          placeholder="Ask the assistant anything, or ask it to use one of the agents it's been granted…"
          className="min-h-24"
          required
        />
        <Button type="submit" className="self-end">
          Start chat
        </Button>
      </form>

      {threads.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No conversations yet — start one above.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {threads.map((run) => (
            <Link key={run.id} href={`/chat/${run.id}`}>
              <Card className="transition-colors hover:border-primary/40">
                <CardContent className="flex items-center justify-between gap-3">
                  <p className="line-clamp-1 flex-1 text-sm">{run.input}</p>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {run.createdAt.toLocaleString()}
                  </span>
                  <RunStatusBadge status={run.status} />
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
