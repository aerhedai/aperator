import type { ReactNode } from "react";

// Unlike layout.tsx, Next.js remounts template.tsx on every navigation —
// that's what makes it the right place for a per-page enter animation.
// Kept intentionally short and subtle: a fade, not a slide-heavy
// production number. The skeletons in loading.tsx cover the "waiting for
// data" case; this covers the "the page itself just changed" case, which
// otherwise reads as a jump-cut.
export default function ShellTemplate({ children }: { children: ReactNode }) {
  return (
    // h-full (not min-h-full): several pages (dashboard, chat) size
    // themselves with h-full and need a parent with a *definite* height to
    // resolve against, exactly like the <main> they used to sit in
    // directly. Content taller than that still overflows visibly and is
    // still captured by <main>'s own overflow-y-auto — this box adds an
    // enter animation, not a clip.
    <div className="h-full animate-in fade-in duration-200 ease-out">
      {children}
    </div>
  );
}
