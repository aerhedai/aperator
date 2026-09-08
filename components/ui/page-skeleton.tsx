import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/**
 * A generic placeholder for the shape almost every (app) route shares:
 * a title + action header, then a stack of card-like rows. Not a
 * pixel-perfect stand-in for any one page — a single shared skeleton for
 * the group is the right amount of investment for what's meant to
 * disappear within a few hundred milliseconds (CLAUDE.md's primitives
 * philosophy applies to UI scaffolding too: one generic shape, not one
 * bespoke skeleton per route).
 */
export function PageSkeleton({
  rows = 5,
  className,
}: {
  rows?: number;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-6 p-6", className)}>
      <div className="flex items-center justify-between">
        <Skeleton className="h-7 w-40" />
        <Skeleton className="h-9 w-28 rounded-lg" />
      </div>
      <div className="flex flex-col gap-3">
        {Array.from({ length: rows }).map((_, i) => (
          <div
            key={i}
            className="flex items-center justify-between gap-4 rounded-lg border border-border p-4"
          >
            <div className="flex flex-1 flex-col gap-2">
              <Skeleton className="h-4 w-1/3" />
              <Skeleton className="h-3 w-2/3" />
            </div>
            <Skeleton className="h-6 w-16 shrink-0 rounded-full" />
          </div>
        ))}
      </div>
    </div>
  );
}
