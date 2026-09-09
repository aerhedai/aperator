const STEPS: { label: string; detail: string; tone?: "success" | "warning" }[] =
  [
    {
      label: "Input received",
      detail: "500 units of Product A for Customer ABC",
    },
    { label: "find_record", detail: "Customer ABC — found" },
    { label: "search_records", detail: "Product A — £15.00, 700 in stock" },
    { label: "Priced", detail: "500 x £15.00 = £7,500" },
    {
      label: "Approval requested",
      detail: "GMAIL_SEND_EMAIL needs a human",
      tone: "warning",
    },
    { label: "GMAIL_SEND_EMAIL", detail: "Quote sent" },
    { label: "Run completed", detail: "8.4s · 375 tokens", tone: "success" },
  ];

// The signature element of the landing page: a real run trace, not a
// decorative screenshot. This is what actually makes Aperator not a
// chatbot — every step here is inspectable, and the "Approval requested"
// row is real: a mutating action pauses for a human by default (see
// lib/policies/policy-engine.ts), it isn't sales copy.
export function RunTraceCard() {
  return (
    <div className="w-full rounded-2xl bg-marketing-ink text-marketing-ink-foreground shadow-2xl shadow-marketing-ink/30 ring-1 ring-white/10">
      <div className="flex items-center gap-2 border-b border-white/10 px-5 py-3.5">
        <span className="size-2.5 rounded-full bg-white/20" />
        <span className="size-2.5 rounded-full bg-white/20" />
        <span className="size-2.5 rounded-full bg-white/20" />
        <span className="ml-3 font-mono text-xs text-marketing-ink-foreground/50">
          Run #1029 · Quote Agent
        </span>
      </div>

      <ol className="flex flex-col gap-3.5 px-5 py-5 font-mono text-[13px] leading-relaxed">
        {STEPS.map((step, index) => (
          <li
            key={step.label}
            className="flex items-baseline gap-3 opacity-0 [animation:trace-in_0.5s_ease-out_forwards]"
            style={{ animationDelay: `${index * 90 + 150}ms` }}
          >
            <span className="text-marketing-ink-foreground/35 tabular-nums">
              {String(index + 1).padStart(2, "0")}
            </span>
            <span
              className={
                step.tone === "success"
                  ? "text-success"
                  : step.tone === "warning"
                    ? "text-warning"
                    : "text-marketing-ink-foreground"
              }
            >
              {step.label}
            </span>
            <span className="text-marketing-ink-foreground/45">
              {step.detail}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}
