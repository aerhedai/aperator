import { prisma } from "@/lib/db/prisma";
import type {
  Prisma,
  RunStatus,
  TaskSchedulePreset,
  TaskStatus,
} from "@/lib/generated/prisma/client";

export function createTask(
  organisationId: string,
  title: string,
  instruction: string,
  plan: Prisma.InputJsonValue,
  schedulePreset: TaskSchedulePreset | null,
) {
  return prisma.task.create({
    data: {
      organisationId,
      title,
      instruction,
      plan,
      schedulePreset,
      // A Routine starts ACTIVE (armed, waiting for its first firing); a
      // one-off Task starts PENDING and moves to RUNNING the moment
      // run-task-plan.ts begins executing it, same instant it's created.
      status: schedulePreset ? "ACTIVE" : "PENDING",
    },
  });
}

export function findTaskById(organisationId: string, taskId: string) {
  return prisma.task.findFirst({ where: { id: taskId, organisationId } });
}

export function updateTaskStatus(taskId: string, status: TaskStatus) {
  return prisma.task.update({ where: { id: taskId }, data: { status } });
}

export function listTasksByOrganisation(organisationId: string) {
  return prisma.task.findMany({
    where: { organisationId },
    orderBy: { createdAt: "desc" },
    include: {
      runs: { orderBy: { createdAt: "desc" }, take: 1 },
    },
  });
}

// Every ACTIVE routine currently due — the cron sweep's own candidate
// list, further filtered in application code (isPresetDue in
// run-task-plan.ts) since "due" depends on comparing the preset's cadence
// against this specific task's last run, not expressible as a single
// where clause across every preset shape.
export function listActiveRoutines(organisationId?: string) {
  return prisma.task.findMany({
    where: {
      status: "ACTIVE",
      schedulePreset: { not: null },
      ...(organisationId ? { organisationId } : {}),
    },
    include: {
      runs: { orderBy: { createdAt: "desc" }, take: 1 },
    },
  });
}

export function createTaskRun(taskId: string) {
  return prisma.taskRun.create({
    data: { taskId, status: "PENDING", startedAt: new Date() },
  });
}

export function updateTaskRunStatus(
  taskRunId: string,
  status: RunStatus,
  completedAt?: Date,
) {
  return prisma.taskRun.update({
    where: { id: taskRunId },
    data: { status, ...(completedAt ? { completedAt } : {}) },
  });
}

export function findTaskRunById(taskRunId: string) {
  return prisma.taskRun.findUnique({
    where: { id: taskRunId },
    include: {
      task: true,
      agentRuns: {
        orderBy: { stepIndex: "asc" },
        include: { agent: { select: { name: true } } },
      },
    },
  });
}
