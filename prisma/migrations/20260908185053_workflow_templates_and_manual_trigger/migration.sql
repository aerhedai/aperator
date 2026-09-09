-- AlterEnum
ALTER TYPE "WorkflowTriggerType" ADD VALUE 'MANUAL';

-- AlterTable
ALTER TABLE "AgentTemplate" ADD COLUMN     "categoryType" TEXT NOT NULL DEFAULT 'steps',
ADD COLUMN     "instructions" TEXT NOT NULL DEFAULT '';

-- CreateTable
CREATE TABLE "WorkflowTemplate" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "classifierInstructions" TEXT NOT NULL,
    "handlers" JSONB NOT NULL DEFAULT '[]',
    "recordTypes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkflowTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WorkflowTemplate_organisationId_idx" ON "WorkflowTemplate"("organisationId");

-- AddForeignKey
ALTER TABLE "WorkflowTemplate" ADD CONSTRAINT "WorkflowTemplate_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
