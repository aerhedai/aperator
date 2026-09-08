import { PageSkeleton } from "@/components/ui/page-skeleton";

// Next.js renders this as the Suspense fallback for every route under
// (app) — dashboard, agents, runs, workflows, catalog, knowledge,
// approvals, settings — while each page's own async server component is
// still fetching. One shared skeleton for the whole group; a route with a
// meaningfully different shape (e.g. chat's thread view) gets its own
// nested loading.tsx instead of forking this one.
export default function Loading() {
  return <PageSkeleton />;
}
