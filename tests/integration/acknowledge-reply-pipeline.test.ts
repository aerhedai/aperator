import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { AIProvider, AIResponse } from "@/lib/ai/provider";
import { prisma } from "@/lib/db/prisma";
import type { Agent } from "@/lib/generated/prisma/client";
import { runHarnessPipeline } from "@/lib/harness/run-harness-pipeline";
import { createRecord } from "@/tests/helpers/records";

// Same rationale as harness-pipeline.test.ts: Ollama isn't reachable from
// CI, so this proves the generic pipeline's control flow — dynamic
// extraction schema, identity resolution, optional lookup, guardrail —
// against the real DB and real MCP tools, with a scripted provider
// standing in for the model.
function scriptedProvider(responses: AIResponse[]): AIProvider {
  let call = 0;
  return {
    generateResponse: async () => {
      const response = responses[call];
      call += 1;
      if (!response) throw new Error("scriptedProvider ran out of responses");
      return response;
    },
  };
}

describe("acknowledge_reply pipeline", () => {
  const organisationId = "test-org-acknowledge-reply";
  let caseAgent: Agent; // a business-defined category unlike anything hardcoded before
  let noGuardrailAgent: Agent;
  let propertyAgent: Agent;

  beforeAll(async () => {
    await prisma.organisation.create({
      data: {
        id: organisationId,
        clerkOrgId: organisationId,
        name: "Acknowledge Reply Test Org",
        currency: "GBP",
      },
    });
    await createRecord(organisationId, "Customer", {
      name: "Jordan Reyes",
      email: "jordan@case-customer.test",
      company: "Reyes & Co",
    });

    // Proves this isn't Complaints/General reskinned — a law-firm-shaped
    // category with its own business-defined field and its own guardrail,
    // configured entirely as data, no new pipeline file.
    caseAgent = await prisma.agent.create({
      data: {
        organisationId,
        name: "Case Inquiry Agent",
        description: "Handles new case inquiries.",
        instructions:
          "Acknowledge the inquiry and note a lawyer will follow up.",
        model: "test-model",
        status: "ACTIVE",
        executionMode: "HARNESS",
        pipelineKey: "acknowledge_reply",
        extractionFields: [
          {
            name: "caseType",
            description: "what kind of legal matter this is",
          },
        ],
        guardrailKeywords: ["guarantee", "certain to win"],
      },
    });
    await prisma.agentTool.createMany({
      data: ["find_record", "GMAIL_SEND_EMAIL"].map((toolName) => ({
        agentId: caseAgent.id,
        toolName,
      })),
    });

    noGuardrailAgent = await prisma.agent.create({
      data: {
        organisationId,
        name: "No Guardrail Agent",
        description: "A category with no guardrail configured.",
        instructions: "Answer helpfully.",
        model: "test-model",
        status: "ACTIVE",
        executionMode: "HARNESS",
        pipelineKey: "acknowledge_reply",
        extractionFields: [],
        guardrailKeywords: [],
      },
    });
    await prisma.agentTool.createMany({
      data: ["GMAIL_SEND_EMAIL"].map((toolName) => ({
        agentId: noGuardrailAgent.id,
        toolName,
      })),
    });

    const propertyType = await prisma.customEntityType.create({
      data: {
        organisationId,
        name: "Property",
        fields: [
          { name: "address", description: "the property address" },
          { name: "tenant", description: "the current tenant's name" },
        ],
      },
    });
    await prisma.customEntityRecord.create({
      data: {
        organisationId,
        entityTypeId: propertyType.id,
        data: { address: "14 Birch Road", tenant: "Jordan Reyes" },
      },
    });

    // A maintenance-shaped category: extracts propertyAddress and is
    // configured to look it up in the Property entity type — proves the
    // lookup wiring end to end, not just that extraction/compose work.
    propertyAgent = await prisma.agent.create({
      data: {
        organisationId,
        name: "Maintenance Request Agent",
        description: "Handles maintenance requests.",
        instructions:
          "Acknowledge the issue and note a technician will follow up.",
        model: "test-model",
        status: "ACTIVE",
        executionMode: "HARNESS",
        pipelineKey: "acknowledge_reply",
        extractionFields: [
          {
            name: "propertyAddress",
            description: "the property address if mentioned",
            lookupRecordType: "Property",
          },
        ],
        guardrailKeywords: [],
      },
    });
    await prisma.agentTool.createMany({
      data: ["search_records", "GMAIL_SEND_EMAIL"].map((toolName) => ({
        agentId: propertyAgent.id,
        toolName,
      })),
    });
  });

  afterAll(async () => {
    const runs = await prisma.agentRun.findMany({
      where: { organisationId },
      select: { id: true },
    });
    const runIds = runs.map((r) => r.id);
    await prisma.approval.deleteMany({ where: { agentRunId: { in: runIds } } });
    await prisma.toolCall.deleteMany({ where: { agentRunId: { in: runIds } } });
    await prisma.runStep.deleteMany({ where: { agentRunId: { in: runIds } } });
    await prisma.agentRun.deleteMany({ where: { organisationId } });
    await prisma.agentTool.deleteMany({
      where: {
        agentId: { in: [caseAgent.id, noGuardrailAgent.id, propertyAgent.id] },
      },
    });
    await prisma.agent.deleteMany({ where: { organisationId } });
    await prisma.customEntityRecord.deleteMany({ where: { organisationId } });
    await prisma.customEntityType.deleteMany({ where: { organisationId } });
    await prisma.organisation.deleteMany({ where: { id: organisationId } });
    await prisma.$disconnect();
  });

  it("uses senderEmail for identification without any LLM-extracted email, and surfaces the business-defined field as a fact", async () => {
    const provider = scriptedProvider([
      { content: '{"customerEmail": null, "caseType": "employment dispute"}' },
      { content: "Thank you for reaching out about your employment dispute." },
    ]);

    const result = await runHarnessPipeline(
      caseAgent,
      "New case inquiry",
      provider,
      "jordan@case-customer.test",
    );

    expect(result.status).toBe("WAITING_FOR_APPROVAL");

    const approval = await prisma.approval.findFirst({
      where: { agentRunId: result.runId },
    });
    expect(approval).toMatchObject({
      proposedInput: { to: "jordan@case-customer.test" },
    });

    // find_customer was called with the structural senderEmail, not
    // anything scraped from free text.
    const customerLookup = await prisma.toolCall.findFirst({
      where: { agentRunId: result.runId, toolName: "find_record" },
    });
    expect(customerLookup?.input).toMatchObject({
      recordType: "Customer",
      field: "email",
      value: "jordan@case-customer.test",
    });
  });

  it("refuses to propose a reply that violates this category's own guardrail", async () => {
    const provider = scriptedProvider([
      { content: '{"customerEmail": null, "caseType": "personal injury"}' },
      { content: "I can guarantee this case will win in court." },
    ]);

    const result = await runHarnessPipeline(
      caseAgent,
      "New case inquiry",
      provider,
      "jordan@case-customer.test",
    );

    expect(result.status).toBe("FAILED");

    const approval = await prisma.approval.findFirst({
      where: { agentRunId: result.runId },
    });
    expect(approval).toBeNull();
  });

  it("a category with no guardrail configured never blocks on wording another category would", async () => {
    const provider = scriptedProvider([
      { content: '{"customerEmail": null}' },
      { content: "I can guarantee we'll get back to you soon." },
    ]);

    const result = await runHarnessPipeline(
      noGuardrailAgent,
      "General question",
      provider,
      "jordan@case-customer.test",
    );

    expect(result.status).toBe("WAITING_FOR_APPROVAL");
  });

  it("fails cleanly with no email available from any source", async () => {
    const provider = scriptedProvider([{ content: '{"customerEmail": null}' }]);

    const result = await runHarnessPipeline(
      noGuardrailAgent,
      "Hello, just a question with no contact info",
      provider,
    );

    expect(result.status).toBe("FAILED");
  });

  it("looks up a custom entity by an extracted field's value and folds the found record into the run — a flat lookup, not a chain", async () => {
    const provider = scriptedProvider([
      {
        content: '{"customerEmail": null, "propertyAddress": "14 Birch Road"}',
      },
      { content: "Thanks for reporting this — a technician will follow up." },
    ]);

    const result = await runHarnessPipeline(
      propertyAgent,
      "There's a leak at 14 Birch Road",
      provider,
      "jordan@case-customer.test",
    );

    expect(result.status).toBe("WAITING_FOR_APPROVAL");

    const lookup = await prisma.toolCall.findFirst({
      where: { agentRunId: result.runId, toolName: "search_records" },
    });
    expect(lookup?.input).toMatchObject({
      recordType: "Property",
      query: "14 Birch Road",
    });
    expect(lookup?.output).toMatchObject({
      found: true,
      records: [{ data: { tenant: "Jordan Reyes" } }],
    });
  });

  it("skips the entity lookup entirely when the extracted value is null — never calls the tool for nothing to search", async () => {
    const provider = scriptedProvider([
      { content: '{"customerEmail": null, "propertyAddress": null}' },
      { content: "Thanks — a technician will follow up shortly." },
    ]);

    const result = await runHarnessPipeline(
      propertyAgent,
      "Something's broken but I didn't say where",
      provider,
      "jordan@case-customer.test",
    );

    expect(result.status).toBe("WAITING_FOR_APPROVAL");

    const lookup = await prisma.toolCall.findFirst({
      where: { agentRunId: result.runId, toolName: "search_records" },
    });
    expect(lookup).toBeNull();
  });
});
