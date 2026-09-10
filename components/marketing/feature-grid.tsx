import { History, ShieldCheck, UserCheck, Wrench } from "lucide-react";
import type { LucideIcon } from "lucide-react";

const FEATURES: { icon: LucideIcon; label: string; detail: string }[] = [
  {
    icon: Wrench,
    label: "Tools & permissions",
    detail:
      "Each worker gets an explicit, per-tool allowlist. A tool call outside that list is refused before it ever reaches the model's request.",
  },
  {
    icon: ShieldCheck,
    label: "Rule engine",
    detail:
      "Deterministic application code decides ALLOW / REQUIRE_APPROVAL / DENY for every action — the model recommends, it never has the final say.",
  },
  {
    icon: UserCheck,
    label: "Human approval",
    detail:
      "Consequential actions pause and wait. Approve or reject from one place, with the exact proposed content in front of you, not a summary.",
  },
  {
    icon: History,
    label: "Audit trail",
    detail:
      "Every activity, decision, tool call, and outcome is persisted from the start — not something you turn on after the first incident.",
  },
];

export function FeatureGrid() {
  return (
    <section className="mx-auto max-w-6xl px-6 py-24">
      <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
        {FEATURES.map((feature) => (
          <div key={feature.label} className="flex flex-col gap-3">
            <feature.icon
              className="size-5 text-marketing-amber"
              strokeWidth={1.75}
            />
            <p className="font-medium text-foreground">{feature.label}</p>
            <p className="text-sm text-muted-foreground">{feature.detail}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
