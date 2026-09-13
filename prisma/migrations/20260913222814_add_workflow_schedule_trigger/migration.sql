-- AlterEnum
ALTER TYPE "WorkflowTriggerType" ADD VALUE 'SCHEDULE';

-- AlterTable
ALTER TABLE "Workflow" ADD COLUMN     "lastScheduledFireAt" TIMESTAMP(3),
ADD COLUMN     "schedulePreset" "TaskSchedulePreset",
ADD COLUMN     "scheduledPrompt" TEXT;
