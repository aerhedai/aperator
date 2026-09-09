import { prisma } from "@/lib/db/prisma";
import * as agentToolRepository from "@/lib/agents/agent-tool-repository";
import {
  DEFAULT_COMPLAINTS_EXTRACTION_FIELDS,
  DEFAULT_COMPLAINTS_GUARDRAIL_KEYWORDS,
  DEFAULT_GENERAL_EXTRACTION_FIELDS,
} from "@/lib/agents/default-agent-config";
import type { Workflow } from "@/lib/generated/prisma/client";
import { seedStarterRecordTypes } from "@/lib/records/starter-record-type-service";

export interface ProvisionEmailWorkflowConfig {
  organisationId: string;
  currency: string;
  model: string;
  // General Inquiry's keywords are deliberately fixed at [] — it's the
  // catch-all handler and should only be reached when nothing more
  // specific matched (see lib/routing/deterministic-classify.ts).
  quoteKeywords: string[];
  complaintsKeywords: string[];
}

/**
 * Provisions the "Email Handling" workflow (a classifier + Quote/
 * Complaints/General Inquiry handler agents, plus starter catalog data)
 * for a given organisation — the real, reusable path a second business
 * onboards through, replacing what used to only exist as inline logic in
 * prisma/seed.ts forked by hand per business.
 *
 * Complaints and General Inquiry are starter *instances* of the generic
 * "acknowledge_reply" pipeline (lib/harness/pipelines/) — this function
 * just picks sensible defaults for them (extraction fields, guardrail
 * keywords, instructions). A business can add further categories of its
 * own the same way, entirely through data (Agent.extractionFields/
 * guardrailKeywords/instructions), with no new pipeline file. Quote stays
 * a real coded pipeline — it's a dependent multi-step tool chain, not
 * something a business can configure into existence (this project's
 * neuro-symbolic harness design: tool *sequencing* is deterministic code,
 * never LLM- or config-decided, see CLAUDE.md #24/#30).
 *
 * Idempotent via deterministic ids derived from organisationId (not fixed
 * ids like "seed-agent-quote", which only work for a single hardcoded demo
 * org) — safe to call repeatedly for the same organisation, e.g. every
 * `pnpm db:seed` run picking up a text/keyword tweak, without duplicating
 * rows or silently skipping catalog updates on re-runs.
 */
export async function provisionEmailWorkflow(
  config: ProvisionEmailWorkflowConfig,
): Promise<Workflow> {
  const { organisationId } = config;

  await prisma.organisation.update({
    where: { id: organisationId },
    data: { currency: config.currency },
  });

  const classifier = {
    id: `${organisationId}-agent-classifier`,
    name: "Inbox Classifier",
    description:
      "Classifies inbound email and routes it to the right specialist agent — not a handler itself.",
    instructions:
      "Classify the inbound message against the specialist agents listed below, based only on their descriptions. If none clearly fit, say so — never guess.",
    model: config.model,
    executionMode: "LOOP" as const,
    pipelineKey: null as string | null,
    keywords: [] as string[],
    toolNames: [] as string[],
    extractionFields: [] as { name: string; description: string }[],
    guardrailKeywords: [] as string[],
  };

  const handlers = [
    {
      id: `${organisationId}-agent-quote`,
      name: "Quote Agent",
      description:
        "Handles requests for a price quote — calculating and sending pricing for a specific product and quantity.",
      instructions:
        "A customer is asking for a price quote. Extract the product and quantity, use the tools to find the customer, find the product, and calculate the total, then send the quote by email.",
      model: config.model,
      executionMode: "HARNESS" as const,
      pipelineKey: "quote",
      keywords: config.quoteKeywords,
      toolNames: [
        "find_record",
        "search_records",
        "GMAIL_SEND_EMAIL",
        "OUTLOOK_SEND_EMAIL",
      ],
      extractionFields: [] as { name: string; description: string }[],
      guardrailKeywords: [] as string[],
    },
    {
      id: `${organisationId}-agent-complaints`,
      name: "Complaints Agent",
      description:
        "Handles complaints or expressions of dissatisfaction from a customer about a product, order, or service they've received.",
      instructions:
        "A customer has a complaint. Acknowledge their concern specifically, never promise compensation, and let them know a team member will follow up.",
      model: config.model,
      executionMode: "HARNESS" as const,
      pipelineKey: "acknowledge_reply",
      keywords: config.complaintsKeywords,
      toolNames: ["find_record", "GMAIL_SEND_EMAIL", "OUTLOOK_SEND_EMAIL"],
      extractionFields: DEFAULT_COMPLAINTS_EXTRACTION_FIELDS,
      guardrailKeywords: DEFAULT_COMPLAINTS_GUARDRAIL_KEYWORDS,
    },
    {
      id: `${organisationId}-agent-general`,
      name: "General Inquiry Agent",
      description:
        "Handles general questions that are not a price quote request and not a complaint — e.g. asking about opening hours, delivery times, or how to place an order.",
      instructions:
        "Answer the inquiry helpfully and directly. If there isn't enough information to answer accurately, say so rather than guessing.",
      model: config.model,
      executionMode: "HARNESS" as const,
      pipelineKey: "acknowledge_reply",
      keywords: [] as string[],
      toolNames: ["find_record", "GMAIL_SEND_EMAIL", "OUTLOOK_SEND_EMAIL"],
      extractionFields: DEFAULT_GENERAL_EXTRACTION_FIELDS,
      guardrailKeywords: [] as string[],
    },
  ];

  const allAgents = [classifier, ...handlers];

  for (const agent of allAgents) {
    await prisma.agent.upsert({
      where: { id: agent.id },
      update: {
        description: agent.description,
        instructions: agent.instructions,
        model: agent.model,
        executionMode: agent.executionMode,
        pipelineKey: agent.pipelineKey,
        keywords: agent.keywords,
        extractionFields: agent.extractionFields,
        guardrailKeywords: agent.guardrailKeywords,
      },
      create: {
        id: agent.id,
        organisationId,
        name: agent.name,
        description: agent.description,
        instructions: agent.instructions,
        model: agent.model,
        executionMode: agent.executionMode,
        pipelineKey: agent.pipelineKey,
        keywords: agent.keywords,
        extractionFields: agent.extractionFields,
        guardrailKeywords: agent.guardrailKeywords,
        status: "ACTIVE",
      },
    });
    await agentToolRepository.setToolsForAgent(agent.id, agent.toolNames);
  }

  // The Quote agent looks records up by type name, so this template has to
  // bring its record types with it — a template specifies Record Types the
  // same way it specifies agents and policies (CLAUDE.md §6). They arrive as
  // ordinary types the business can rename, extend or delete, which is the
  // whole difference from the Product/Customer tables these replaced.
  await seedStarterRecordTypes(organisationId);

  const workflow = await prisma.workflow.upsert({
    where: { id: `${organisationId}-workflow-email` },
    update: {},
    create: {
      id: `${organisationId}-workflow-email`,
      organisationId,
      name: "Email Handling",
      description:
        "Classifies inbound customer emails and routes them to the right specialist agent.",
      trigger: "EMAIL",
      status: "ACTIVE",
      source: "TEMPLATE",
      templateKey: "email_handling",
    },
  });

  const members = [
    { agentId: classifier.id, role: "CLASSIFIER" as const },
    ...handlers.map((h) => ({ agentId: h.id, role: "HANDLER" as const })),
  ];
  for (const member of members) {
    await prisma.workflowAgent.upsert({
      where: {
        workflowId_agentId: {
          workflowId: workflow.id,
          agentId: member.agentId,
        },
      },
      update: { role: member.role },
      create: {
        workflowId: workflow.id,
        agentId: member.agentId,
        role: member.role,
      },
    });
  }

  return workflow;
}
