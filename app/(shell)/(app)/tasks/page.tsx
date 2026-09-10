import Link from "next/link";

import { RunStatusBadge } from "@/components/runs/run-status-badge";
import { TaskStatusBadge } from "@/components/tasks/task-status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getCurrentOrganisation } from "@/lib/organisations/current-organisation";
import * as taskRepository from "@/lib/tasks/task-repository";

export const dynamic = "force-dynamic";

const PRESET_LABELS: Record<string, string> = {
  HOURLY: "Every hour",
  DAILY_9AM: "Daily, 9am",
  WEEKDAYS_9AM: "Weekdays, 9am",
  WEEKLY_MONDAY_9AM: "Weekly, Mon 9am",
};

export default async function TasksPage() {
  const organisation = await getCurrentOrganisation();
  const tasks = await taskRepository.listTasksByOrganisation(organisation.id);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold">Tasks</h1>
        <p className="text-sm text-muted-foreground">
          Everything you&rsquo;ve told chat to do — one-off tasks and recurring
          routines, in one place.{" "}
          <Link href="/chat" className="underline">
            Ask chat for a new one
          </Link>
          .
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base font-medium">
            {tasks.length} task{tasks.length === 1 ? "" : "s"}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {tasks.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">
              Nothing here yet — ask chat to do something and it&rsquo;ll show
              up as a task.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground">
                  <th className="px-4 py-2 font-medium">Title</th>
                  <th className="px-4 py-2 font-medium">Type</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                  <th className="px-4 py-2 font-medium">Last run</th>
                  <th className="px-4 py-2 font-medium">Created</th>
                </tr>
              </thead>
              <tbody>
                {tasks.map((task) => {
                  const lastRun = task.runs[0];
                  return (
                    <tr
                      key={task.id}
                      className="border-b border-border last:border-0"
                    >
                      <td className="px-4 py-3">
                        <div className="font-medium">{task.title}</div>
                        <div className="text-xs text-muted-foreground">
                          {task.instruction}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {task.schedulePreset
                          ? `Routine — ${PRESET_LABELS[task.schedulePreset] ?? task.schedulePreset}`
                          : "Task"}
                      </td>
                      <td className="px-4 py-3">
                        <TaskStatusBadge status={task.status} />
                      </td>
                      <td className="px-4 py-3">
                        {lastRun ? (
                          <RunStatusBadge status={lastRun.status} />
                        ) : (
                          <span className="text-muted-foreground">
                            never run
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {task.createdAt.toLocaleDateString()}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
