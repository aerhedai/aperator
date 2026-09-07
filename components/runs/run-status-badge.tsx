import { Badge } from "@/components/ui/badge";
import type { RunStatus } from "@/lib/generated/prisma/client";

const STYLES: Record<RunStatus, string> = {
  PENDING: "bg-muted text-muted-foreground",
  RUNNING: "bg-warning/15 text-warning border-transparent",
  WAITING_FOR_APPROVAL: "bg-warning/15 text-warning border-transparent",
  WAITING_FOR_INPUT:
    "bg-app-accent-soft text-app-accent-soft-foreground border-transparent",
  COMPLETED: "bg-success/15 text-success border-transparent",
  FAILED: "bg-destructive/10 text-destructive border-transparent",
  CANCELLED: "bg-muted text-muted-foreground",
};

export function RunStatusBadge({ status }: { status: RunStatus }) {
  return (
    <Badge variant="outline" className={STYLES[status]}>
      {status.replaceAll("_", " ")}
    </Badge>
  );
}
