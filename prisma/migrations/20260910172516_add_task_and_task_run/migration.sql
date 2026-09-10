-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED', 'ACTIVE', 'PAUSED');

-- CreateEnum
CREATE TYPE "TaskSchedulePreset" AS ENUM ('HOURLY', 'DAILY_9AM', 'WEEKDAYS_9AM', 'WEEKLY_MONDAY_9AM');

-- AlterTable
ALTER TABLE "AgentRun" ADD COLUMN     "stepIndex" INTEGER,
ADD COLUMN     "taskRunId" TEXT;

-- CreateTable
CREATE TABLE "Task" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "instruction" TEXT NOT NULL,
    "plan" JSONB NOT NULL,
    "schedulePreset" "TaskSchedulePreset",
    "status" "TaskStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskRun" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "status" "RunStatus" NOT NULL DEFAULT 'PENDING',
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Task_organisationId_idx" ON "Task"("organisationId");

-- CreateIndex
CREATE INDEX "Task_organisationId_schedulePreset_status_idx" ON "Task"("organisationId", "schedulePreset", "status");

-- CreateIndex
CREATE INDEX "TaskRun_taskId_idx" ON "TaskRun"("taskId");

-- CreateIndex
CREATE INDEX "AgentRun_taskRunId_idx" ON "AgentRun"("taskRunId");

-- AddForeignKey
ALTER TABLE "AgentRun" ADD CONSTRAINT "AgentRun_taskRunId_fkey" FOREIGN KEY ("taskRunId") REFERENCES "TaskRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskRun" ADD CONSTRAINT "TaskRun_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
