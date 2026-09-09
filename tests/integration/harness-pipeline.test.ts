import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { AIProvider, AIResponse } from "@/lib/ai/provider";
import { prisma } from "@/lib/db/prisma";
import type { Agent, User } from "@/lib/generated/prisma/client";
import { runHarnessPipeline } from "@/lib/harness/run-harness-pipeline";
import { resumeRun } from "@/lib/runtime/agent-runtime";
import { provisionEmailWorkflow } from "@/lib/workflows/provision-email-workflow";
import { createRecord } from "@/tests/helpers/records";

// Same rationale as agent-runtime.test.ts: Ollama isn't reachable from CI,
// so the harness's control flow — extraction, deterministic tool
// sequencing, approval gating, resume — is proven here with a scripted
// provider against the real DB and real MCP tools.

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

async function cleanUpProvisionOrg(organisationId: string) {
  await prisma.approval.deleteMany({ where: { organisationId } });
  await prisma.toolCall.deleteMany({ where: { agentRun: { organisationId } } });
  await prisma.runStep.deleteMany({ where: { agentRun: { organisationId } } });
  await prisma.agentRun.deleteMany({ where: { organisationId } });
  await prisma.workflowAgent.deleteMany({
    where: { workflow: { organisationId } },
  });
  await prisma.workflow.deleteMany({ where: { organisationId } });
  await prisma.agentTool.deleteMany({ where: { agent: { organisationId } } });
  await prisma.agent.deleteMany({ where: { organisationId } });
  await prisma.customEntityRecord.deleteMany({
    where: { organisationId: organisationId },
  });
  await prisma.customEntityType.deleteMany({
    where: { organisationId: organisationId },
  });
  await prisma.organisation.deleteMany({ where: { id: organisationId } });
}

describe("harness pipeline", () => {
  const organisationId = "test-org-harness";
  let quoteAgent: Agent;
  let restrictedQuoteAgent: Agent;
  let approver: User;

  beforeAll(async () => {
    await prisma.organisation.create({
      data: {
        id: organisationId,
        clerkOrgId: organisationId,
        name: "Harness Test Org",
        currency: "GBP",
      },
    });
    // Real per-org catalog rows the pipeline's real find_record /
    // search_records tool calls resolve against.
    await createRecord(organisationId, "Product", {
      sku: "TEST-WIDGET-A",
      name: "Product A",
      unitPrice: 15,
      stockQuantity: 700,
    });
    await createRecord(organisationId, "Customer", {
      name: "Test Customer",
      email: "buyer@customer-abc.test",
      company: "Customer ABC Ltd",
    });

    quoteAgent = await prisma.agent.create({
      data: {
        organisationId,
        name: "Quote Agent",
        description: "Handles price quotes.",
        instructions: "A customer is asking for a price quote.",
        model: "test-model",
        status: "ACTIVE",
        executionMode: "HARNESS",
        pipelineKey: "quote",
      },
    });
    await prisma.agentTool.createMany({
      data: ["find_record", "search_records", "GMAIL_SEND_EMAIL"].map(
        (toolName) => ({
          agentId: quoteAgent.id,
          toolName,
        }),
      ),
    });

    restrictedQuoteAgent = await prisma.agent.create({
      data: {
        organisationId,
        name: "Restricted Quote Agent",
        description: "Used to test tool restriction inside a pipeline.",
        instructions: "A customer is asking for a price quote.",
        model: "test-model",
        status: "ACTIVE",
        executionMode: "HARNESS",
        pipelineKey: "quote",
      },
    });
    // Deliberately missing search_records (the product lookup) and GMAIL_SEND_EMAIL.
    await prisma.agentTool.createMany({
      data: ["find_record"].map((toolName) => ({
        agentId: restrictedQuoteAgent.id,
        toolName,
      })),
    });

    approver = await prisma.user.create({
      data: {
        organisationId,
        clerkUserId: "test-approver-harness",
        email: "approver@harness-test.local",
        name: "Test Approver",
        role: "APPROVER",
      },
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
      where: { agentId: { in: [quoteAgent.id, restrictedQuoteAgent.id] } },
    });
    await prisma.agent.deleteMany({ where: { organisationId } });
    await prisma.user.deleteMany({ where: { organisationId } });
    await prisma.customEntityRecord.deleteMany({
      where: { organisationId: organisationId },
    });
    await prisma.customEntityType.deleteMany({
      where: { organisationId: organisationId },
    });
    await prisma.organisation.deleteMany({ where: { id: organisationId } });
    await prisma.$disconnect();
  });

  const extractionResponse: AIResponse = {
    content:
      '{"product": "Product A", "quantity": 500, "customerEmail": "buyer@customer-abc.test"}',
    usage: { promptTokens: 100, completionTokens: 20 },
  };
  const composeResponse: AIResponse = {
    content: "Dear customer, your quote is £7,500.",
    usage: { promptTokens: 80, completionTokens: 15 },
  };

  it("runs the deterministic pipeline, records token usage per LLM call, and pauses for approval on GMAIL_SEND_EMAIL", async () => {
    const provider = scriptedProvider([extractionResponse, composeResponse]);

    const result = await runHarnessPipeline(
      quoteAgent,
      "Quote 500 units of Product A",
      provider,
    );

    expect(result.status).toBe("WAITING_FOR_APPROVAL");

    const run = await prisma.agentRun.findUniqueOrThrow({
      where: { id: result.runId },
      include: {
        steps: { orderBy: { createdAt: "asc" }, include: { toolCall: true } },
      },
    });

    expect(run.steps.map((s) => s.stepType)).toEqual([
      "INPUT_RECEIVED",
      "AGENT_DECISION", // extraction
      "TOOL_CALL", // find_record  (customer)
      "TOOL_CALL", // search_records (product)
      "AGENT_DECISION", // compose
      "APPROVAL_REQUESTED",
    ]);

    // Tool sequencing was entirely deterministic — no LLM decided which
    // tool to call, so exactly these two, in this order, every time.
    // Pricing is arithmetic the pipeline does inline, so it is no longer a
    // tool call at all (CLAUDE.md §3).
    const toolSteps = run.steps.filter((s) => s.stepType === "TOOL_CALL");
    expect(toolSteps.map((s) => s.toolCall?.toolName)).toEqual([
      "find_record",
      "search_records",
    ]);
    expect(toolSteps.every((s) => s.toolCall?.status === "SUCCESS")).toBe(true);

    // Token usage recorded on both LLM-backed steps, matching the scripted
    // usage exactly.
    const decisionSteps = run.steps.filter(
      (s) => s.stepType === "AGENT_DECISION",
    );
    expect(
      decisionSteps.map((s) => [s.promptTokens, s.completionTokens]),
    ).toEqual([
      [100, 20],
      [80, 15],
    ]);

    const approval = await prisma.approval.findFirst({
      where: { agentRunId: result.runId },
    });
    expect(approval).toMatchObject({
      status: "PENDING",
      requestedAction: "GMAIL_SEND_EMAIL",
      proposedInput: {
        to: "buyer@customer-abc.test",
        subject: "Quote for 500 x Product A",
      },
    });
  });

  it("resumes with no further LLM call — the pipeline already finished its work before proposing the send", async () => {
    const provider = scriptedProvider([extractionResponse, composeResponse]);
    const paused = await runHarnessPipeline(
      quoteAgent,
      "Quote 500 units of Product A",
      provider,
    );
    expect(paused.status).toBe("WAITING_FOR_APPROVAL");

    // No responses left in the queue — if resume tried to call the LLM
    // again, scriptedProvider would throw, which is itself part of what
    // this test proves.
    const resumeProvider = scriptedProvider([]);
    const resumed = await resumeRun(
      paused.runId,
      organisationId,
      "APPROVED",
      approver.id,
      resumeProvider,
    );

    // GMAIL_SEND_EMAIL genuinely runs here (the real tool, not a mock) — it
    // fails because this test org has no Gmail integration connected,
    // same as the equivalent LOOP-mode test. That's the correct, realistic
    // outcome to assert: the call only happens post-approval, and a real
    // failure doesn't crash the run or fall back to another LLM call.
    expect(resumed.status).toBe("FAILED");

    const run = await prisma.agentRun.findUniqueOrThrow({
      where: { id: paused.runId },
      include: { steps: { orderBy: { createdAt: "asc" } } },
    });
    expect(run.steps.at(-1)).toMatchObject({ stepType: "RUN_FAILED" });

    const sentToolCall = await prisma.toolCall.findFirst({
      where: { agentRunId: paused.runId, toolName: "GMAIL_SEND_EMAIL" },
    });
    expect(sentToolCall).toMatchObject({ status: "FAILED" });
    expect(sentToolCall?.error).toMatch(/gmail is not connected/i);
  });

  it("cancels cleanly on rejection — GMAIL_SEND_EMAIL never runs", async () => {
    const provider = scriptedProvider([extractionResponse, composeResponse]);
    const paused = await runHarnessPipeline(
      quoteAgent,
      "Quote 500 units of Product A",
      provider,
    );
    expect(paused.status).toBe("WAITING_FOR_APPROVAL");

    const resumed = await resumeRun(
      paused.runId,
      organisationId,
      "REJECTED",
      approver.id,
    );
    expect(resumed.status).toBe("CANCELLED");

    const sentToolCall = await prisma.toolCall.findFirst({
      where: { agentRunId: paused.runId, toolName: "GMAIL_SEND_EMAIL" },
    });
    expect(sentToolCall).toBeNull();
  });

  it("fails cleanly when extraction can't find a product and quantity — no tool calls attempted", async () => {
    const provider = scriptedProvider([
      { content: '{"product": null, "quantity": null, "customerEmail": null}' },
    ]);

    const result = await runHarnessPipeline(
      quoteAgent,
      "Hello, just saying hi",
      provider,
    );

    expect(result.status).toBe("FAILED");

    const toolCalls = await prisma.toolCall.findMany({
      where: { agentRunId: result.runId },
    });
    expect(toolCalls).toHaveLength(0);
  });

  it("respects per-agent tool restriction inside the pipeline — a disallowed tool is refused, not silently used", async () => {
    const provider = scriptedProvider([extractionResponse]);

    const result = await runHarnessPipeline(
      restrictedQuoteAgent,
      "Quote 500 units of Product A",
      provider,
    );

    // find_record succeeds (granted); search_records — the product lookup —
    // is refused (not granted), which the pipeline treats as a failed step
    // and stops. The fixed sequence doesn't bypass AgentTool just because
    // it's hardcoded in code.
    expect(result.status).toBe("FAILED");

    const toolCalls = await prisma.toolCall.findMany({
      where: { agentRunId: result.runId },
      orderBy: { createdAt: "asc" },
    });
    expect(toolCalls.map((t) => [t.toolName, t.status])).toEqual([
      ["find_record", "SUCCESS"],
      ["search_records", "FAILED"],
    ]);
    expect(
      toolCalls.find((t) => t.toolName === "search_records")?.error,
    ).toMatch(/does not have access/i);
  });

  it("grants a provisioned quote agent every tool its pipeline actually calls", async () => {
    // Regression test for a real migration bug: the tool consolidation
    // mapped the old find_product grant onto find_record, but the quote
    // pipeline's product lookup had become search_records — leaving
    // already-provisioned quote agents unable to complete a run, with the
    // grant check correctly refusing a tool they should have held.
    //
    // Asserted behaviourally rather than by comparing two lists: what the
    // pipeline needs isn't introspectable, so the only honest check is to
    // run it against a genuinely provisioned agent and require that
    // nothing was refused.
    const provisionOrgId = "test-org-harness-provisioned";
    // Tolerate leftovers from an interrupted earlier run rather than
    // failing on a unique-constraint violation unrelated to what's tested.
    await cleanUpProvisionOrg(provisionOrgId);
    await prisma.organisation.create({
      data: {
        id: provisionOrgId,
        clerkOrgId: provisionOrgId,
        name: "Provisioned Harness Org",
        currency: "GBP",
      },
    });
    await provisionEmailWorkflow({
      organisationId: provisionOrgId,
      currency: "GBP",
      model: "test-model",
      quoteKeywords: ["quote"],
      complaintsKeywords: ["complaint"],
    });
    await createRecord(provisionOrgId, "Product", {
      sku: "PROV-WIDGET",
      name: "Product A",
      unitPrice: 15,
      stockQuantity: 700,
    });
    await createRecord(provisionOrgId, "Customer", {
      name: "Provisioned Buyer",
      email: "buyer@provisioned.test",
      company: "Provisioned Ltd",
    });

    const provisionedQuoteAgent = await prisma.agent.findFirstOrThrow({
      where: { organisationId: provisionOrgId, pipelineKey: "quote" },
    });

    const result = await runHarnessPipeline(
      provisionedQuoteAgent,
      "Quote 500 units of Product A for buyer@provisioned.test",
      scriptedProvider([extractionResponse, composeResponse]),
    );

    const toolCalls = await prisma.toolCall.findMany({
      where: { agentRunId: result.runId },
    });
    const refused = toolCalls.filter((t) =>
      /does not have access/i.test(t.error ?? ""),
    );
    expect(refused.map((t) => t.toolName)).toEqual([]);
    expect(result.status).toBe("WAITING_FOR_APPROVAL");

    await cleanUpProvisionOrg(provisionOrgId);
  });
});
