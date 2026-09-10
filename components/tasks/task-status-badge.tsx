import { Badge } from "@/components/ui/badge";
import type { TaskStatus } from "@/lib/generated/prisma/client";

// One-off Task statuses reuse RunStatusBadge's own colors for the
// equivalent meaning (PENDING/RUNNING/COMPLETED/FAILED/CANCELLED); ACTIVE
// and PAUSED are Routine-only and have no RunStatus analogue.
const STYLES: Record<TaskStatus, string> = {
  PENDING: "bg-muted text-muted-foreground",
  RUNNING: "bg-warning/15 text-warning border-transparent",
  COMPLETED: "bg-success/15 text-success border-transparent",
  FAILED: "bg-destructive/10 text-destructive border-transparent",
  CANCELLED: "bg-muted text-muted-foreground",
  ACTIVE: "bg-success/15 text-success border-transparent",
  PAUSED: "bg-muted text-muted-foreground",
};

export function TaskStatusBadge({ status }: { status: TaskStatus }) {
  return (
    <Badge variant="outline" className={STYLES[status]}>
      {status}
    </Badge>
  );
}
