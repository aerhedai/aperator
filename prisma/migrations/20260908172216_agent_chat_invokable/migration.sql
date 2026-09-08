/*
  Warnings:

  - You are about to drop the `AgentInvocationGrant` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "AgentInvocationGrant" DROP CONSTRAINT "AgentInvocationGrant_orchestratorAgentId_fkey";

-- DropForeignKey
ALTER TABLE "AgentInvocationGrant" DROP CONSTRAINT "AgentInvocationGrant_targetAgentId_fkey";

-- AlterTable
ALTER TABLE "Agent" ADD COLUMN     "chatInvokable" BOOLEAN NOT NULL DEFAULT true;

-- DropTable
DROP TABLE "AgentInvocationGrant";
