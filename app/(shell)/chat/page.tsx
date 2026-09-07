import { Mic, Plus, Settings } from "lucide-react";
import Link from "next/link";

import { startChatAction } from "@/app/(shell)/chat/actions";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

export const dynamic = "force-dynamic";

export default function ChatPage() {
  return (
    <div className="mx-auto flex h-full max-w-2xl flex-col px-6 py-6">
      <div className="flex justify-end">
        <Link
          href="/chat/settings"
          aria-label="Assistant settings"
          title="Assistant settings"
          className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <Settings className="size-4" />
        </Link>
      </div>

      <div className="flex flex-1 flex-col items-center justify-center gap-4">
        <p className="text-sm text-muted-foreground">What can I help with?</p>

        <form
          action={startChatAction}
          className="flex w-full flex-col gap-1 rounded-3xl border border-border bg-card p-3 shadow-sm"
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
      </div>
    </div>
  );
}
