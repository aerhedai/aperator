import type { ReactNode } from "react";

// See app/(shell)/template.tsx for why this lives in a template rather
// than the layout. Marketing pages use normal document scroll (no h-full
// dependency), so no extra height plumbing is needed here.
export default function MarketingTemplate({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <div className="animate-in fade-in duration-200 ease-out">{children}</div>
  );
}
