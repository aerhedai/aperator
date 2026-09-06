import { afterAll, describe, expect, it } from "vitest";

import type {
  AIProvider,
  AIResponse,
  GenerateRequest,
} from "@/lib/ai/provider";
import { prisma } from "@/lib/db/prisma";
import { runHarnessPipeline } from "@/lib/harness/run-harness-pipeline";
import { provisionEmailWorkflow } from "@/lib/workflows/provision-email-workflow";
import { createRecord } from "@/tests/helpers/records";

// The concrete proof that provisionEmailWorkflow() genuinely supports more
// than one business: two organisations provisioned with different
// currency/catalog/names, and neither's composed reply or approval ever
// references the other's data.

function recordingScriptedProvider(responses: AIResponse[]) {
  let call = 0;
  const requests: GenerateRequest[] = [];
  const provider: AIProvider = {
    generateResponse: async (request) => {
      requests.push(request);
      const response = responses[call];
      call += 1;
      if (!response) throw new Error("scriptedProvider ran out of responses");
      return response;
    },
  };
  return { provider, requests };
}

describe("multi-org catalog isolation", () => {
  const orgAId = "test-org-isolation-a";
  const orgBId = "test-org-isolation-b";

  afterAll(async () => {
    for (const organisationId of [orgAId, orgBId]) {
      const runs = await prisma.agentRun.findMany({
        where: { organisationId },
        select: { id: true },
      });
      const runIds = runs.map((r) => r.id);
      await prisma.approval.deleteMany({
        where: { agentRunId: { in: runIds } },
      });
      await prisma.toolCall.deleteMany({
        where: { agentRunId: { in: runIds } },
      });
      await prisma.runStep.deleteMany({
        where: { agentRunId: { in: runIds } },
      });
      await prisma.agentRun.deleteMany({ where: { organisationId } });
      await prisma.workflowAgent.deleteMany({
        where: { workflow: { organisationId } },
      });
      await prisma.workflow.deleteMany({ where: { organisationId } });
      await prisma.agentTool.deleteMany({
        where: { agent: { organisationId } },
      });
      await prisma.agent.deleteMany({ where: { organisationId } });
      await prisma.customEntityRecord.deleteMany({
        where: { organisationId: organisationId },
      });
      await prisma.customEntityType.deleteMany({
        where: { organisationId: organisationId },
      });
      await prisma.organisation.deleteMany({ where: { id: organisationId } });
    }
    await prisma.$disconnect();
  });

  it("keeps two organisations' catalog, currency, and sign-off fully isolated", async () => {
    // Genuinely heavy: two full org provisions (each its own workflow + 4
    // agents) plus two real runHarnessPipeline calls, all against real
    // Postgres — measured ~4.2s alone, close enough to Vitest's 5s default
    // that it (and other unrelated heavy tests) intermittently timed out
    // under full-suite load. See vitest.config.ts's testTimeout for the
    // actual fix; this comment just explains why this specific test is
    // one of the heavier ones.
    await prisma.organisation.create({
      data: { id: orgAId, clerkOrgId: orgAId, name: "Acme Test Co" },
    });
    await prisma.organisation.create({
      data: { id: orgBId, clerkOrgId: orgBId, name: "Northwind Test Co" },
    });

    await provisionEmailWorkflow({
      organisationId: orgAId,
      currency: "GBP",
      model: "test-model",
      quoteKeywords: ["quote"],
      complaintsKeywords: ["complaint"],
    });
    await createRecord(orgAId, "Product", {
      sku: "A-SKU",
      name: "Acme Widget",
      unitPrice: 15,
      stockQuantity: 100,
    });
    await createRecord(orgAId, "Customer", {
      name: "A Customer",
      email: "buyer@acme-test.local",
      company: "Acme Buyer Co",
    });
    await provisionEmailWorkflow({
      organisationId: orgBId,
      currency: "USD",
      model: "test-model",
      quoteKeywords: ["quote"],
      complaintsKeywords: ["complaint"],
    });
    await createRecord(orgBId, "Product", {
      sku: "B-SKU",
      name: "Northwind Bolt",
      unitPrice: 8.25,
      stockQuantity: 500,
    });
    await createRecord(orgBId, "Customer", {
      name: "B Customer",
      email: "buyer@northwind-test.local",
      company: "Northwind Buyer Co",
    });

    const quoteAgentA = await prisma.agent.findFirstOrThrow({
      where: { organisationId: orgAId, pipelineKey: "quote" },
    });
    const quoteAgentB = await prisma.agent.findFirstOrThrow({
      where: { organisationId: orgBId, pipelineKey: "quote" },
    });

    const { provider: providerA, requests: requestsA } =
      recordingScriptedProvider([
        {
          content:
            '{"product": "Acme Widget", "quantity": 10, "customerEmail": "buyer@acme-test.local"}',
        },
        { content: "Body A" },
      ]);
    const resultA = await runHarnessPipeline(
      quoteAgentA,
      "Quote 10 units of Acme Widget",
      providerA,
    );
    expect(resultA.status).toBe("WAITING_FOR_APPROVAL");

    const { provider: providerB, requests: requestsB } =
      recordingScriptedProvider([
        {
          content:
            '{"product": "Northwind Bolt", "quantity": 20, "customerEmail": "buyer@northwind-test.local"}',
        },
        { content: "Body B" },
      ]);
    const resultB = await runHarnessPipeline(
      quoteAgentB,
      "Quote 20 units of Northwind Bolt",
      providerB,
    );
    expect(resultB.status).toBe("WAITING_FOR_APPROVAL");

    // The second (compose) call's user message is the "facts" string built
    // from real tool results — assert it's genuinely org-specific, not
    // shared/leaked between the two runs.
    const composeFactsA =
      requestsA[1]?.messages.find((m) => m.role === "user")?.content ?? "";
    const composeFactsB =
      requestsB[1]?.messages.find((m) => m.role === "user")?.content ?? "";

    expect(composeFactsA).toContain("£");
    expect(composeFactsA).toContain("Acme Widget");
    expect(composeFactsA).not.toContain("Northwind Bolt");
    expect(composeFactsA).not.toContain("$");

    expect(composeFactsB).toContain("$");
    expect(composeFactsB).toContain("Northwind Bolt");
    expect(composeFactsB).not.toContain("Acme Widget");
    expect(composeFactsB).not.toContain("£");

    // The compose *instructions* (system message) carry the sign-off —
    // confirm each is signed with its own business name, not a shared
    // generic "The team".
    const composeInstructionsA =
      requestsA[1]?.messages.find((m) => m.role === "system")?.content ?? "";
    const composeInstructionsB =
      requestsB[1]?.messages.find((m) => m.role === "system")?.content ?? "";
    expect(composeInstructionsA).toContain("The Acme Test Co team");
    expect(composeInstructionsB).toContain("The Northwind Test Co team");

    // Approval proposedInput's "to" address further confirms no cross-org
    // customer bleed.
    const approvalA = await prisma.approval.findFirst({
      where: { agentRunId: resultA.runId },
    });
    const approvalB = await prisma.approval.findFirst({
      where: { agentRunId: resultB.runId },
    });
    expect(approvalA?.proposedInput).toMatchObject({
      to: "buyer@acme-test.local",
    });
    expect(approvalB?.proposedInput).toMatchObject({
      to: "buyer@northwind-test.local",
    });
  }, 20000);
});
