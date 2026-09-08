import { Skeleton } from "@/components/ui/skeleton";

// Mirrors ChatThread's actual layout (components/chat/chat-thread.tsx) —
// same scroll area and composer bar dimensions — so swapping the real
// thread in doesn't shift anything on screen, just the fade handled by
// the (shell) template.
export default function Loading() {
  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 overflow-y-auto px-6 py-6">
        <div className="mx-auto flex max-w-2xl flex-col gap-5">
          <div className="flex flex-col items-end gap-1.5">
            <Skeleton className="h-4 w-2/5" />
          </div>
          <div className="flex flex-col items-start gap-1.5">
            <Skeleton className="h-4 w-3/5" />
            <Skeleton className="h-4 w-1/3" />
          </div>
          <div className="flex flex-col items-end gap-1.5">
            <Skeleton className="h-4 w-1/4" />
          </div>
          <div className="flex flex-col items-start gap-1.5">
            <Skeleton className="h-4 w-2/5" />
          </div>
        </div>
      </div>
      <div className="px-6 pb-6">
        <div className="mx-auto h-24 max-w-2xl rounded-3xl border border-border bg-card p-3 shadow-sm">
          <Skeleton className="h-4 w-1/2" />
        </div>
      </div>
    </div>
  );
}
