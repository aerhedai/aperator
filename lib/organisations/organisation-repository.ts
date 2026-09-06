import { prisma } from "@/lib/db/prisma";
import type {
  LegalLinksInput,
  OrganisationInput,
} from "@/lib/organisations/schemas";

export function findOrganisationById(id: string) {
  return prisma.organisation.findUnique({ where: { id } });
}

export function updateOrganisation(id: string, input: OrganisationInput) {
  return prisma.organisation.update({
    where: { id },
    data: input,
  });
}

export function updateLegalLinks(id: string, input: LegalLinksInput) {
  return prisma.organisation.update({
    where: { id },
    data: input,
  });
}

// Separate from updateOrganisation/OrganisationInput deliberately: this
// isn't filled in through the general org-settings form the way
// name/currency are, it's set by a dedicated "make this provider active"
// action (lib/ai/organisation-ai-provider.ts), so it doesn't belong in
// that schema's shape.
export function setActiveAiProvider(id: string, activeAiProvider: string) {
  return prisma.organisation.update({
    where: { id },
    data: { activeAiProvider },
  });
}

// No relation on Organisation declares onDelete: Cascade (a business
// deleting one row of catalog data should never silently take the whole
// org with it), so a real org deletion has to remove every dependent row
// itself, in FK dependency order, deepest child first. Wrapped in
// $transaction so a failure partway through leaves the org intact rather
// than half-deleted.
export async function deleteOrganisationCascade(organisationId: string) {
  await prisma.$transaction([
    prisma.runStep.deleteMany({
      where: { agentRun: { organisationId } },
    }),
    prisma.toolCall.deleteMany({
      where: { agentRun: { organisationId } },
    }),
    prisma.approval.deleteMany({ where: { organisationId } }),
    prisma.agentRun.deleteMany({ where: { organisationId } }),
    prisma.workflowAgent.deleteMany({
      where: { agent: { organisationId } },
    }),
    prisma.agentTool.deleteMany({
      where: { agent: { organisationId } },
    }),
    prisma.agent.deleteMany({ where: { organisationId } }),
    prisma.workflow.deleteMany({ where: { organisationId } }),
    prisma.customEntityRecord.deleteMany({ where: { organisationId } }),
    prisma.customEntityType.deleteMany({ where: { organisationId } }),
    prisma.integration.deleteMany({ where: { organisationId } }),
    prisma.user.deleteMany({ where: { organisationId } }),
    prisma.organisation.delete({ where: { id: organisationId } }),
  ]);
}
