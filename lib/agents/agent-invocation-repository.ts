import { prisma } from "@/lib/db/prisma";

export async function findInvokableAgentIdsFor(
  orchestratorAgentId: string,
): Promise<string[]> {
  const rows = await prisma.agentInvocationGrant.findMany({
    where: { orchestratorAgentId },
    select: { targetAgentId: true },
  });
  return rows.map((row) => row.targetAgentId);
}

export async function isAgentInvocationGranted(
  orchestratorAgentId: string,
  targetAgentId: string,
): Promise<boolean> {
  const grant = await prisma.agentInvocationGrant.findUnique({
    where: {
      orchestratorAgentId_targetAgentId: {
        orchestratorAgentId,
        targetAgentId,
      },
    },
    select: { id: true },
  });
  return grant !== null;
}

/**
 * Replaces an agent's invocation grants wholesale — same transactional
 * delete-then-recreate shape as setToolsForAgent, same reasoning: a real
 * user-facing write path where a double submit or a mid-write crash
 * shouldn't leave the grant list in a half-written state.
 */
export async function setInvokableAgentsFor(
  orchestratorAgentId: string,
  targetAgentIds: string[],
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.agentInvocationGrant.deleteMany({
      where: { orchestratorAgentId },
    });
    if (targetAgentIds.length > 0) {
      await tx.agentInvocationGrant.createMany({
        data: targetAgentIds.map((targetAgentId) => ({
          orchestratorAgentId,
          targetAgentId,
        })),
      });
    }
  });
}
