import Link from "next/link";

import { Button } from "@/components/ui/button";

export function CtaBand() {
  return (
    <section className="bg-marketing-ink text-marketing-ink-foreground">
      <div className="mx-auto flex max-w-6xl flex-col items-start gap-6 px-6 py-20 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-heading text-2xl font-bold tracking-tight sm:text-3xl">
            Give a worker a real process to run.
          </h2>
          <p className="mt-2 max-w-md text-marketing-ink-foreground/60">
            Set up a worker, hand it a test input, and watch the whole activity
            — tool by tool — before it ever touches production.
          </p>
        </div>
        <Button
          size="lg"
          nativeButton={false}
          render={<Link href="/sign-up" />}
          className="h-11 shrink-0 bg-marketing-amber px-6 text-base text-marketing-amber-foreground hover:bg-marketing-amber/85"
        >
          Get started
        </Button>
      </div>
    </section>
  );
}
