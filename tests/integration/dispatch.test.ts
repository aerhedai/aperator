import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { AIProvider, AIResponse } from "@/lib/ai/provider";
import { prisma } from "@/lib/db/prisma";
import * as integrationService from "@/lib/integrations/integration-service";
import {
  dispatchInboundMessage,
  dispatchScheduledWorkflow,
} from "@/lib/routing/dispatch";
import * as workflowRepository from "@/lib/workflows/workflow-repository";

// Ollama isn't reachable from CI — classification and the handler's own
// run both go through the same scripted provider here, proving the real
// dispatch → classify → runAgent wiring end to end against the real DB.
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

describe("dispatchInboundMessage", () => {
  const organisationId = "test-org-dispatch";
  let classifierId: string;
  let quoteAgentId: string;
  let complaintsAgentId: string;
  let workflowId: string;

  beforeAll(async () => {
    await prisma.organisation.create({
      data: {
        id: organisationId,
        clerkOrgId: organisationId,
        name: "Dispatch Test Org",
      },
    });

    const classifier = await prisma.agent.create({
      data: {
        organisationId,
        name: "Test Classifier",
        description: "Routes inbound messages.",
        instructions: "Decide which agent should handle this message.",
        model: "test-model",
        status: "ACTIVE",
      },
    });
    classifierId = classifier.id;

    const quoteAgent = await prisma.agent.create({
      data: {
        organisationId,
        name: "Quote Agent",
        description: "Handles price quotes.",
        instructions: "Handle the quote request.",
        model: "test-model",
        status: "ACTIVE",
      },
    });
    quoteAgentId = quoteAgent.id;

    const complaintsAgent = await prisma.agent.create({
      data: {
        organisationId,
        name: "Complaints Agent",
        description: "Handles complaints.",
        instructions: "Handle the complaint.",
        model: "test-model",
        status: "ACTIVE",
      },
    });
    complaintsAgentId = complaintsAgent.id;

    const workflow = await prisma.workflow.create({
      data: {
        organisationId,
        name: "Email Handling",
        description: "Test workflow.",
        trigger: "EMAIL",
        status: "ACTIVE",
      },
    });
    workflowId = workflow.id;

    await prisma.workflowAgent.createMany({
      data: [
        { workflowId, agentId: classifierId, role: "CLASSIFIER" },
        { workflowId, agentId: quoteAgentId, role: "HANDLER" },
        { workflowId, agentId: complaintsAgentId, role: "HANDLER" },
      ],
    });
  });

  afterAll(async () => {
    const runs = await prisma.agentRun.findMany({
      where: { organisationId },
      select: { id: true },
    });
    const runIds = runs.map((r) => r.id);
    await prisma.toolCall.deleteMany({ where: { agentRunId: { in: runIds } } });
    await prisma.runStep.deleteMany({ where: { agentRunId: { in: runIds } } });
    await prisma.agentRun.deleteMany({ where: { organisationId } });
    await prisma.workflowAgent.deleteMany({ where: { workflowId } });
    await prisma.workflow.deleteMany({ where: { organisationId } });
    await prisma.agent.deleteMany({ where: { organisationId } });
    await prisma.customEntityRecord.deleteMany({
      where: { organisationId: organisationId },
    });
    await prisma.customEntityType.deleteMany({
      where: { organisationId: organisationId },
    });
    await prisma.organisation.deleteMany({ where: { id: organisationId } });
    await prisma.$disconnect();
  });

  it("classifies and runs the matched handler agent", async () => {
    const provider = scriptedProvider([
      { content: `{"agentId": "${quoteAgentId}"}` }, // classification
      { content: "Here's your quote." }, // the handler's own run
    ]);

    const result = await dispatchInboundMessage(
      organisationId,
      "EMAIL",
      "Can I get a quote for 500 units of Product A?",
      provider,
    );

    expect(result).toMatchObject({
      matched: true,
      agentId: quoteAgentId,
      agentName: "Quote Agent",
    });
    if (!result.matched) throw new Error("expected matched result");
    expect(result.run.status).toBe("COMPLETED");

    const run = await prisma.agentRun.findUniqueOrThrow({
      where: { id: result.run.runId },
    });
    expect(run.agentId).toBe(quoteAgentId);
  });

  it("runs nothing when the classifier finds no clear match", async () => {
    const provider = scriptedProvider([{ content: '{"agentId": null}' }]);

    const before = await prisma.agentRun.count({ where: { organisationId } });
    const result = await dispatchInboundMessage(
      organisationId,
      "EMAIL",
      "A newsletter that doesn't need a reply",
      provider,
    );
    const after = await prisma.agentRun.count({ where: { organisationId } });

    expect(result).toEqual({ matched: false, reason: "no_match" });
    expect(after).toBe(before);
  });

  it("reports no_workflow when the organisation has no active EMAIL workflow", async () => {
    const otherOrg = await prisma.organisation.create({
      data: {
        clerkOrgId: "test-clerk-org-no-workflow",
        name: "No Workflow Org",
      },
    });

    const result = await dispatchInboundMessage(
      otherOrg.id,
      "EMAIL",
      "Anything",
      scriptedProvider([]),
    );

    expect(result).toEqual({ matched: false, reason: "no_workflow" });

    await prisma.customEntityRecord.deleteMany({
      where: { organisationId: otherOrg.id },
    });
    await prisma.customEntityType.deleteMany({
      where: { organisationId: otherOrg.id },
    });
    await prisma.organisation.delete({ where: { id: otherOrg.id } });
  });

  it("routes to a lone active handler without calling the classifier at all", async () => {
    // A workflow with one active handler has no routing decision to make.
    // Asking the model a question with one possible answer is pure waste,
    // and deterministicClassify can't cover it — that only matches agents
    // with keywords configured, so a keyword-less single handler used to
    // pay for a full LLM classification every message.
    const orgId = "test-org-dispatch-single-handler";
    await prisma.organisation.create({
      data: { id: orgId, clerkOrgId: orgId, name: "Single Handler Org" },
    });
    const classifier = await prisma.agent.create({
      data: {
        organisationId: orgId,
        name: "Classifier",
        description: "Routes inbound messages.",
        instructions: "Decide which agent should handle this message.",
        model: "test-model",
        status: "ACTIVE",
      },
    });
    const onlyHandler = await prisma.agent.create({
      data: {
        organisationId: orgId,
        name: "Only Handler",
        description: "Handles everything.",
        instructions: "Handle it.",
        model: "test-model",
        status: "ACTIVE",
        executionMode: "HARNESS",
        pipelineKey: "steps",
        // Deliberately no keywords — the keyword fast path must not be
        // what makes this pass.
        keywords: [],
        pipelineConfig: {
          steps: [
            {
              kind: "compute",
              as: "noted",
              operation: "template",
              operands: ["handled"],
            },
          ],
        } as never,
      },
    });
    const workflow = await prisma.workflow.create({
      data: {
        organisationId: orgId,
        name: "Email Handling",
        description: "Test workflow.",
        trigger: "EMAIL",
        status: "ACTIVE",
      },
    });
    await prisma.workflowAgent.createMany({
      data: [
        { workflowId: workflow.id, agentId: classifier.id, role: "CLASSIFIER" },
        { workflowId: workflow.id, agentId: onlyHandler.id, role: "HANDLER" },
      ],
    });

    try {
      // scriptedProvider([]) throws the moment anything asks the model, so
      // this passing is the proof that no LLM call happened.
      const result = await dispatchInboundMessage(
        orgId,
        "EMAIL",
        "Anything at all",
        scriptedProvider([]),
      );

      expect(result.matched).toBe(true);
      if (result.matched) expect(result.agentId).toBe(onlyHandler.id);
    } finally {
      await prisma.toolCall.deleteMany({
        where: { agentRun: { organisationId: orgId } },
      });
      await prisma.runStep.deleteMany({
        where: { agentRun: { organisationId: orgId } },
      });
      await prisma.agentRun.deleteMany({ where: { organisationId: orgId } });
      await prisma.workflowAgent.deleteMany({
        where: { workflowId: workflow.id },
      });
      await prisma.workflow.deleteMany({ where: { organisationId: orgId } });
      await prisma.agent.deleteMany({ where: { organisationId: orgId } });
      await prisma.customEntityRecord.deleteMany({
        where: { organisationId: orgId },
      });
      await prisma.customEntityType.deleteMany({
        where: { organisationId: orgId },
      });
      await prisma.organisation.deleteMany({ where: { id: orgId } });
    }
  });

  it("never lets the sender's address influence classification — found live: an address containing a keyword substring silently misrouted every message", async () => {
    // Self-contained org/agents so keyword-based deterministic routing
    // (irrelevant to the rest of this file, which relies on the LLM
    // classifier always firing) can't affect the other tests above.
    const orgId = "test-org-dispatch-sender-isolation";
    await prisma.organisation.create({
      data: { id: orgId, clerkOrgId: orgId, name: "Sender Isolation Org" },
    });
    const classifier = await prisma.agent.create({
      data: {
        organisationId: orgId,
        name: "Classifier",
        description: "Routes inbound messages.",
        instructions: "Decide which agent should handle this message.",
        model: "test-model",
        status: "ACTIVE",
      },
    });
    const quoteAgent = await prisma.agent.create({
      data: {
        organisationId: orgId,
        name: "Quote Agent",
        description: "Handles price quotes.",
        instructions: "Handle the quote request.",
        model: "test-model",
        status: "ACTIVE",
        keywords: ["price"],
      },
    });
    const complaintsAgent = await prisma.agent.create({
      data: {
        organisationId: orgId,
        name: "Complaints Agent",
        description: "Handles complaints.",
        instructions: "Handle the complaint.",
        model: "test-model",
        status: "ACTIVE",
        keywords: ["broken"],
      },
    });
    const workflow = await prisma.workflow.create({
      data: {
        organisationId: orgId,
        name: "Email Handling",
        description: "Test workflow.",
        trigger: "EMAIL",
        status: "ACTIVE",
      },
    });
    await prisma.workflowAgent.createMany({
      data: [
        { workflowId: workflow.id, agentId: classifier.id, role: "CLASSIFIER" },
        { workflowId: workflow.id, agentId: quoteAgent.id, role: "HANDLER" },
        {
          workflowId: workflow.id,
          agentId: complaintsAgent.id,
          role: "HANDLER",
        },
      ],
    });

    try {
      // Message content matches only the Complaints Agent's keyword
      // ("broken"); the sender's own address happens to contain the Quote
      // Agent's keyword ("...price@..."). Only one scripted response is
      // loaded — if the sender's address leaked into the classification
      // text and caused an LLM classifier call (or a wrong deterministic
      // match), this throws "ran out of responses" or asserts the wrong
      // agent, instead of routing straight to Complaints with zero LLM
      // calls.
      const provider = scriptedProvider([{ content: "Sorry to hear that." }]);
      const result = await dispatchInboundMessage(
        orgId,
        "EMAIL",
        "The item arrived broken.",
        provider,
        "jordan.price@example.com",
      );

      expect(result).toMatchObject({
        matched: true,
        agentId: complaintsAgent.id,
        agentName: "Complaints Agent",
      });
    } finally {
      const runs = await prisma.agentRun.findMany({
        where: { organisationId: orgId },
        select: { id: true },
      });
      const runIds = runs.map((r) => r.id);
      await prisma.toolCall.deleteMany({
        where: { agentRunId: { in: runIds } },
      });
      await prisma.runStep.deleteMany({
        where: { agentRunId: { in: runIds } },
      });
      await prisma.agentRun.deleteMany({ where: { organisationId: orgId } });
      await prisma.workflowAgent.deleteMany({
        where: { workflowId: workflow.id },
      });
      await prisma.workflow.deleteMany({ where: { organisationId: orgId } });
      await prisma.agent.deleteMany({ where: { organisationId: orgId } });
      await prisma.customEntityRecord.deleteMany({
        where: { organisationId: orgId },
      });
      await prisma.customEntityType.deleteMany({
        where: { organisationId: orgId },
      });
      await prisma.organisation.deleteMany({ where: { id: orgId } });
    }
  });

  it("routes two WEBHOOK-triggered workflows on different accounts independently, and falls back a null-bound workflow when passed a real account id", async () => {
    // Self-contained org: exercises the account-specification feature
    // (Workflow.triggerIntegrationId) end to end through the real dispatch
    // path, not just the repository/service layer tests.
    const orgId = "test-org-dispatch-account-binding";
    await prisma.organisation.create({
      data: { id: orgId, clerkOrgId: orgId, name: "Account Binding Org" },
    });

    const classifier = await prisma.agent.create({
      data: {
        organisationId: orgId,
        name: "Classifier",
        description: "Routes inbound messages.",
        instructions: "Decide which agent should handle this message.",
        model: "test-model",
        status: "ACTIVE",
      },
    });
    const agentA = await prisma.agent.create({
      data: {
        organisationId: orgId,
        name: "Agent A",
        description: "Handles account A's traffic.",
        instructions: "Handle it.",
        model: "test-model",
        status: "ACTIVE",
      },
    });
    const agentB = await prisma.agent.create({
      data: {
        organisationId: orgId,
        name: "Agent B",
        description: "Handles account B's traffic.",
        instructions: "Handle it.",
        model: "test-model",
        status: "ACTIVE",
      },
    });

    const { integration: accountA } =
      await integrationService.connectWebhookAccount(orgId, "Account A");
    const { integration: accountB } =
      await integrationService.connectWebhookAccount(orgId, "Account B");

    const workflowA = await prisma.workflow.create({
      data: {
        organisationId: orgId,
        name: "Workflow A",
        description: "d",
        trigger: "WEBHOOK",
        triggerIntegrationId: accountA.id,
        status: "ACTIVE",
      },
    });
    const workflowB = await prisma.workflow.create({
      data: {
        organisationId: orgId,
        name: "Workflow B",
        description: "d",
        trigger: "WEBHOOK",
        triggerIntegrationId: accountB.id,
        status: "ACTIVE",
      },
    });
    await prisma.workflowAgent.createMany({
      data: [
        {
          workflowId: workflowA.id,
          agentId: classifier.id,
          role: "CLASSIFIER",
        },
        { workflowId: workflowA.id, agentId: agentA.id, role: "HANDLER" },
        {
          workflowId: workflowB.id,
          agentId: classifier.id,
          role: "CLASSIFIER",
        },
        { workflowId: workflowB.id, agentId: agentB.id, role: "HANDLER" },
      ],
    });

    // A generic (null-bound) EMAIL workflow, standing in for the pre-existing
    // default every organisation had before account binding existed —
    // checkInboxAction now always passes a real Gmail integration id, so
    // dispatch must still find this via its fallback (workflow-service.ts's
    // findActiveWorkflowForDispatch) or every organisation with only one
    // Gmail account would silently stop routing email.
    const emailAgent = await prisma.agent.create({
      data: {
        organisationId: orgId,
        name: "Email Agent",
        description: "Handles email.",
        instructions: "Handle it.",
        model: "test-model",
        status: "ACTIVE",
      },
    });
    const emailWorkflow = await prisma.workflow.create({
      data: {
        organisationId: orgId,
        name: "Generic Email",
        description: "d",
        trigger: "EMAIL",
        triggerIntegrationId: null,
        status: "ACTIVE",
      },
    });
    await prisma.workflowAgent.createMany({
      data: [
        {
          workflowId: emailWorkflow.id,
          agentId: classifier.id,
          role: "CLASSIFIER",
        },
        {
          workflowId: emailWorkflow.id,
          agentId: emailAgent.id,
          role: "HANDLER",
        },
      ],
    });
    const gmailAccount = await integrationService.connectGmailAccount(
      orgId,
      "inbox@acme.test",
      {
        accessToken: "a",
        refreshToken: "r",
        expiresAt: new Date(Date.now() + 3600_000),
      },
    );

    try {
      const resultA = await dispatchInboundMessage(
        orgId,
        "WEBHOOK",
        "Anything",
        scriptedProvider([{ content: `{"agentId": "${agentA.id}"}` }]),
        null,
        accountA.id,
      );
      const resultB = await dispatchInboundMessage(
        orgId,
        "WEBHOOK",
        "Anything",
        scriptedProvider([{ content: `{"agentId": "${agentB.id}"}` }]),
        null,
        accountB.id,
      );
      const resultEmail = await dispatchInboundMessage(
        orgId,
        "EMAIL",
        "Anything",
        scriptedProvider([{ content: `{"agentId": "${emailAgent.id}"}` }]),
        null,
        gmailAccount.id,
      );

      expect(resultA).toMatchObject({ matched: true, agentId: agentA.id });
      expect(resultB).toMatchObject({ matched: true, agentId: agentB.id });
      expect(resultEmail).toMatchObject({
        matched: true,
        agentId: emailAgent.id,
      });
    } finally {
      const runs = await prisma.agentRun.findMany({
        where: { organisationId: orgId },
        select: { id: true },
      });
      const runIds = runs.map((r) => r.id);
      await prisma.toolCall.deleteMany({
        where: { agentRunId: { in: runIds } },
      });
      await prisma.runStep.deleteMany({
        where: { agentRunId: { in: runIds } },
      });
      await prisma.agentRun.deleteMany({ where: { organisationId: orgId } });
      await prisma.workflowAgent.deleteMany({
        where: { workflow: { organisationId: orgId } },
      });
      await prisma.workflow.deleteMany({ where: { organisationId: orgId } });
      await prisma.agent.deleteMany({ where: { organisationId: orgId } });
      await prisma.integration.deleteMany({ where: { organisationId: orgId } });
      await prisma.customEntityRecord.deleteMany({
        where: { organisationId: orgId },
      });
      await prisma.customEntityType.deleteMany({
        where: { organisationId: orgId },
      });
      await prisma.organisation.deleteMany({ where: { id: orgId } });
    }
  });
});

describe("dispatchScheduledWorkflow", () => {
  it("uses scheduledPrompt as the synthetic input, and no_match is a clean outcome, not an error", async () => {
    const orgId = "test-org-dispatch-scheduled";
    await prisma.organisation.create({
      data: { id: orgId, clerkOrgId: orgId, name: "Scheduled Dispatch Org" },
    });
    const classifier = await prisma.agent.create({
      data: {
        organisationId: orgId,
        name: "Classifier",
        description: "Decides what needs doing.",
        instructions: "Decide which worker should handle this.",
        model: "test-model",
        status: "ACTIVE",
      },
    });
    const handlerA = await prisma.agent.create({
      data: {
        organisationId: orgId,
        name: "Handler A",
        description: "Checks overdue invoices.",
        instructions: "Check invoices.",
        model: "test-model",
        status: "ACTIVE",
      },
    });
    const handlerB = await prisma.agent.create({
      data: {
        organisationId: orgId,
        name: "Handler B",
        description: "Checks low stock.",
        instructions: "Check stock.",
        model: "test-model",
        status: "ACTIVE",
      },
    });
    const workflow = await prisma.workflow.create({
      data: {
        organisationId: orgId,
        name: "Scheduled Department",
        description: "d",
        trigger: "SCHEDULE",
        status: "ACTIVE",
        schedulePreset: "DAILY_9AM",
        scheduledPrompt: "Check overdue invoices only.",
      },
    });
    await prisma.workflowAgent.createMany({
      data: [
        { workflowId: workflow.id, agentId: classifier.id, role: "CLASSIFIER" },
        { workflowId: workflow.id, agentId: handlerA.id, role: "HANDLER" },
        { workflowId: workflow.id, agentId: handlerB.id, role: "HANDLER" },
      ],
    });

    try {
      const fetched = await workflowRepository.findActiveScheduledWorkflows();
      const found = fetched.find((w) => w.id === workflow.id);
      if (!found) throw new Error("expected to find the scheduled workflow");

      // Captures every generateResponse call so the classification call can
      // be checked for scheduledPrompt as its actual input — proving that's
      // what fed the classifier, not some other fallback.
      const calls: { messages: { role: string; content: string }[] }[] = [];
      const inner = scriptedProvider([
        { content: `{"agentId": "${handlerA.id}"}` },
        { content: "Checked — nothing overdue." },
      ]);
      const capturingProvider: AIProvider = {
        generateResponse: async (params) => {
          calls.push(params);
          return inner.generateResponse(params);
        },
      };

      const matchedResult = await dispatchScheduledWorkflow(
        found,
        capturingProvider,
      );
      expect(matchedResult).toMatchObject({
        matched: true,
        agentId: handlerA.id,
      });
      const classifyCall = calls[0];
      const userMessage = classifyCall?.messages.find((m) => m.role === "user");
      expect(userMessage?.content).toBe("Check overdue invoices only.");

      // A second firing where the classifier decides nothing needs
      // doing: no_match, not a thrown error.
      const noMatchResult = await dispatchScheduledWorkflow(
        found,
        scriptedProvider([{ content: '{"agentId": null}' }]),
      );
      expect(noMatchResult).toEqual({ matched: false, reason: "no_match" });
    } finally {
      const runs = await prisma.agentRun.findMany({
        where: { organisationId: orgId },
        select: { id: true },
      });
      const runIds = runs.map((r) => r.id);
      await prisma.toolCall.deleteMany({
        where: { agentRunId: { in: runIds } },
      });
      await prisma.runStep.deleteMany({
        where: { agentRunId: { in: runIds } },
      });
      await prisma.agentRun.deleteMany({ where: { organisationId: orgId } });
      await prisma.workflowAgent.deleteMany({
        where: { workflowId: workflow.id },
      });
      await prisma.workflow.deleteMany({ where: { organisationId: orgId } });
      await prisma.agent.deleteMany({ where: { organisationId: orgId } });
      await prisma.customEntityRecord.deleteMany({
        where: { organisationId: orgId },
      });
      await prisma.customEntityType.deleteMany({
        where: { organisationId: orgId },
      });
      await prisma.organisation.deleteMany({ where: { id: orgId } });
    }
  });
});
