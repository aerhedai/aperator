const STAGES = [
  "Trigger",
  "Worker",
  "Tools",
  "Rule",
  "Approval",
  "Action",
  "Audit trail",
];

export function HowItWorks() {
  return (
    <section className="border-y border-border bg-secondary/40">
      <div className="mx-auto max-w-6xl px-6 py-20">
        <p className="font-mono text-xs tracking-wide text-muted-foreground uppercase">
          How an activity actually flows
        </p>
        <h2 className="mt-3 font-heading text-2xl font-bold tracking-tight sm:text-3xl">
          The same fixed pipeline, every time.
        </h2>

        <div className="mt-10 flex flex-wrap items-center gap-x-2 gap-y-4">
          {STAGES.map((stage, index) => (
            <div key={stage} className="flex items-center gap-2">
              <span className="rounded-full border border-border bg-background px-4 py-2 text-sm font-medium">
                {stage}
              </span>
              {index < STAGES.length - 1 && (
                <span className="text-muted-foreground" aria-hidden>
                  →
                </span>
              )}
            </div>
          ))}
        </div>

        <p className="mt-8 max-w-2xl text-sm text-muted-foreground">
          Approval only appears in the loop when a rule requires it — a £7,500
          quote goes straight through; a £27,000 one waits for a person. Nothing
          skips the audit trail either way.
        </p>
      </div>
    </section>
  );
}
