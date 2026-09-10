const POINTS = [
  {
    label: "Tools, not free text",
    detail:
      "A worker can only call the tools you've explicitly granted it — find_record, create_record, send_email. It can't do anything you haven't wired up.",
  },
  {
    label: "Rules, not vibes",
    detail:
      "Whether an action needs approval is decided by deterministic application code, not the model's judgment. The AI recommends; rules decide.",
  },
  {
    label: "A record, not a transcript",
    detail:
      "Every input, decision, tool call, and outcome is persisted — inspectable per activity, not just logged to a chat window that scrolls away.",
  },
];

export function NotAChatbot() {
  return (
    <section id="product" className="mx-auto max-w-6xl scroll-mt-16 px-6 py-24">
      <div className="max-w-2xl">
        <p className="font-mono text-xs tracking-wide text-muted-foreground uppercase">
          The distinction that matters
        </p>
        <h2 className="mt-3 font-heading text-3xl font-bold tracking-tight text-balance sm:text-4xl">
          A chatbot answers questions. This finishes the process.
        </h2>
        <p className="mt-4 text-lg text-muted-foreground text-pretty">
          Most &ldquo;AI agent&rdquo; products are a chat window with a system
          prompt. Aperator is built the other way round: business logic and
          permissions come first, and the model works inside them.
        </p>
      </div>

      <dl className="mt-14 grid gap-10 sm:grid-cols-3">
        {POINTS.map((point) => (
          <div key={point.label} className="flex flex-col gap-2">
            <dt className="font-medium text-foreground">{point.label}</dt>
            <dd className="text-sm text-muted-foreground">{point.detail}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
