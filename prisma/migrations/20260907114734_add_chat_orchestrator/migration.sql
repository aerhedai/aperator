-- AlterEnum
ALTER TYPE "AgentExecutionMode" ADD VALUE 'CHAT';

-- AlterEnum
ALTER TYPE "RunStatus" ADD VALUE 'WAITING_FOR_INPUT';

-- CreateTable
CREATE TABLE "AgentInvocationGrant" (
    "id" TEXT NOT NULL,
    "orchestratorAgentId" TEXT NOT NULL,
    "targetAgentId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentInvocationGrant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AgentInvocationGrant_orchestratorAgentId_idx" ON "AgentInvocationGrant"("orchestratorAgentId");

-- CreateIndex
CREATE INDEX "AgentInvocationGrant_targetAgentId_idx" ON "AgentInvocationGrant"("targetAgentId");

-- CreateIndex
CREATE UNIQUE INDEX "AgentInvocationGrant_orchestratorAgentId_targetAgentId_key" ON "AgentInvocationGrant"("orchestratorAgentId", "targetAgentId");

-- AddForeignKey
ALTER TABLE "AgentInvocationGrant" ADD CONSTRAINT "AgentInvocationGrant_orchestratorAgentId_fkey" FOREIGN KEY ("orchestratorAgentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentInvocationGrant" ADD CONSTRAINT "AgentInvocationGrant_targetAgentId_fkey" FOREIGN KEY ("targetAgentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
