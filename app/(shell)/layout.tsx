import type { ReactNode } from "react";

import { TopBar } from "@/components/layout/top-bar";

// Sits above Home (the (app) group), Templates, and Docs alike — the org
// switcher and account menu live here rather than in the sidebar, since
// they're relevant no matter which of the three you're in. The sidebar
// itself (components/layout/sidebar.tsx) only renders inside the (app)
// group, i.e. only under Home.
export default function ShellLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-screen flex-col">
      <TopBar />
      <div className="min-h-0 flex-1">{children}</div>
    </div>
  );
}
