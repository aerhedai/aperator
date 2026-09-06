-- DropForeignKey
ALTER TABLE "AgentTemplate" DROP CONSTRAINT "AgentTemplate_organisationId_fkey";

-- DropIndex
DROP INDEX "KnowledgeChunk_embedding_idx";

-- AlterTable
ALTER TABLE "Organisation" ADD COLUMN     "activeAiProvider" TEXT;

-- AddForeignKey
ALTER TABLE "AgentTemplate" ADD CONSTRAINT "AgentTemplate_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
