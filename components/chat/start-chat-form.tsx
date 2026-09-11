"use client";

import { useLayoutEffect, useRef, useState } from "react";

import { ArrowUp, Mic, Plus } from "lucide-react";

import { startChatAction } from "@/app/(shell)/chat/actions";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

/**
 * The empty-chat composer. Vertically centered at rest, the same shape
 * every "new chat" screen uses — but pressing submit here also has to
 * become the bottom-pinned composer ChatThread renders once the run
 * exists, and a hard route change in between makes that jump look
 * abrupt. This animates the hand-off with a manual FLIP: measure the
 * composer's position before the layout flips it to the bottom, offset it
 * straight back with no transition, then release the offset next frame so
 * the browser plays a real slide instead of a jump-cut. The actual
 * navigation (startChatAction's redirect) still happens underneath —
 * this only smooths the visual moment leading into it.
 */
export function StartChatForm() {
  const [submitting, setSubmitting] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const beforeTopRef = useRef<number | null>(null);

  useLayoutEffect(() => {
    if (!submitting) return;
    const el = formRef.current;
    const before = beforeTopRef.current;
    if (!el || before === null) return;

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const after = el.getBoundingClientRect().top;
    const delta = before - after;
    if (delta === 0) return;

    el.style.transition = "none";
    el.style.transform = `translateY(${delta}px)`;
    el.getBoundingClientRect(); // flush the layout before releasing it below
    requestAnimationFrame(() => {
      el.style.transition = "transform 320ms cubic-bezier(0.22, 1, 0.36, 1)";
      el.style.transform = "translateY(0)";
    });
  }, [submitting]);

  return (
    <div
      className={cn(
        "flex flex-1 flex-col items-center gap-4",
        submitting ? "justify-end pb-6" : "justify-center",
      )}
    >
      <p
        className={cn(
          "text-sm text-muted-foreground transition-opacity duration-150",
          submitting && "opacity-0",
        )}
      >
        What can I help with?
      </p>

      <form
        ref={formRef}
        action={startChatAction}
        onSubmit={() => {
          beforeTopRef.current =
            formRef.current?.getBoundingClientRect().top ?? null;
          setSubmitting(true);
        }}
        className="flex w-full flex-col gap-1 rounded-3xl border border-border bg-card p-3 shadow-sm"
      >
        <Textarea
          name="message"
          placeholder="Ask the assistant anything, or ask it to use one of the workers it's been granted…"
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
          <Button
            type="submit"
            disabled={submitting}
            className="rounded-full p-2.5"
            aria-label="Submit message"
            title="Submit message"
          >
            <ArrowUp className="size-4" />
          </Button>
        </div>
      </form>
    </div>
  );
}
