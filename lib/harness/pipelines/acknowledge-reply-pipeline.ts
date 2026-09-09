import { z } from "zod";

import { composeReply } from "@/lib/harness/compose-reply";
import {
  composeBaseInstructions,
  withBusinessGuidance,
} from "@/lib/harness/compose-instructions";
import { extractFields } from "@/lib/harness/extract-fields";
import {
  callTool,
  extractEmailDeterministically,
} from "@/lib/harness/pipeline-helpers";
import { containsForbiddenKeyword } from "@/lib/harness/pipeline-guards";
import { failPipeline } from "@/lib/harness/pipeline-failure";
import { proposeAction, resolveActionTool } from "@/lib/harness/propose-action";
import { extractionFieldsSchema } from "@/lib/agents/extraction-fields";
import type { Pipeline } from "@/lib/harness/types";

/**
 * The general-purpose category shape: extract some business-defined facts,
 * optionally identify the customer, write a reply, apply the business's
 * own guardrail, propose sending it. This is what "Complaints" and
 * "General Inquiry" both actually were underneath — nearly identical code
 * differing only in which fields to pull out, what to say, and whether a
 * guardrail applies (see docs/production-notes.md for the comparison that
 * motivated this). Those are now Agent.extractionFields/instructions/
 * guardrailKeywords — data a business configures per category — instead
 * of a separate TypeScript file per category.
 *
 * Deliberately NOT a general tool-chaining engine: every lookup here
 * (find_record, plus one search_records call per extraction field
 * configured with a lookupRecordType) is independent and flat — keyed off
 * a value already in hand, never off another lookup's result the way
 * Quote's product lookup -> pricing -> reply is a real
 * dependent chain. A category that genuinely needs that kind of
 * multi-step lookup still needs its own coded pipeline (CLAUDE.md
 * #24/#30 — no generic workflow-node engine yet); this covers the "read
 * it, understand it, respond appropriately" shape that most business
 * email categories actually are.
 */
export const runAcknowledgeReplyPipeline: Pipeline = async (context) => {
  const configuredFields = extractionFieldsSchema.parse(
    context.agent.extractionFields,
  );

  // customerEmail is always asked for, in addition to whatever the
  // business configured — a category never has to think about identity
  // extraction, only what's specific to it. See extraction-fields.ts's
  // RESERVED_EXTRACTION_FIELD_NAMES.
  const schemaShape: Record<string, z.ZodType<string | null>> = {
    customerEmail: z.string().nullable(),
  };
  const promptFieldLines = [
    '"customerEmail": string or null (the customer\'s email address, if mentioned)',
  ];
  for (const field of configuredFields) {
    schemaShape[field.name] = z.string().nullable();
    promptFieldLines.push(
      `"${field.name}": string or null (${field.description})`,
    );
  }
  const fieldsSchema = z.object(schemaShape);

  const fields = await extractFields(
    context,
    `Extract fields from the message as JSON: {${promptFieldLines.join(", ")}}. Use null for anything not present. Output ONLY the JSON object, no other text.`,
    fieldsSchema,
  );

  const email =
    context.senderEmail ??
    extractEmailDeterministically(context.input) ??
    fields?.customerEmail ??
    null;
  if (!email) {
    return failPipeline(context, "No customer email address to reply to.");
  }

  let customerName: string | null = null;
  if (context.allowedTools.has("find_record")) {
    const customerResult = await callTool(context, "find_record", {
      recordType: "Customer",
      field: "email",
      value: email,
    });
    if (!customerResult.isError && customerResult.structuredContent?.found) {
      const record = customerResult.structuredContent.record as {
        data: Record<string, unknown>;
      } | null;
      const name = record?.data.name;
      customerName = typeof name === "string" ? name : null;
    }
  }

  const extractedFacts = configuredFields
    .map((field) => {
      const value = fields?.[field.name];
      return value ? `${field.description}: ${value}` : null;
    })
    .filter((line): line is string => line !== null);

  // Independent, flat lookups — one per extracted field that's configured
  // to look something up, each keyed off that field's own value alone.
  // Deliberately not chained (this field's lookup never feeds another
  // field's lookup) — see this file's own top-of-file comment on why.
  const entityFacts: string[] = [];
  if (context.allowedTools.has("search_records")) {
    for (const field of configuredFields) {
      if (!field.lookupRecordType) continue;
      const value = fields?.[field.name];
      if (!value) continue;

      const result = await callTool(context, "search_records", {
        recordType: field.lookupRecordType,
        query: value,
      });
      if (result.isError || !result.structuredContent?.found) continue;

      const records = result.structuredContent.records as {
        data: Record<string, unknown>;
      }[];
      const record = records[0];
      if (!record) continue;

      const recordFacts = Object.entries(record.data)
        .map(([key, val]) => `${key}: ${val}`)
        .join(", ");
      entityFacts.push(
        `${field.lookupRecordType} record found: ${recordFacts}`,
      );
    }
  }

  const body = await composeReply(
    context,
    withBusinessGuidance(
      `${composeBaseInstructions(context.organisation.name)} Acknowledge the customer's message and respond appropriately, based on the facts below. You may not have complete information — if you're unsure of a specific fact, price, policy, or decision, say a member of the team will follow up rather than guessing. Do not include a subject line, just the body text.`,
      context.agent,
    ),
    [
      customerName
        ? `Customer: ${customerName}`
        : 'Customer name: unknown — do not invent or placeholder one, open with "Hello,"',
      ...extractedFacts,
      ...entityFacts,
    ].join("\n"),
  );

  // Deterministic backstop — see pipeline-guards.ts. Empty guardrailKeywords
  // means this check always passes; a business opts in per category.
  if (containsForbiddenKeyword(body, context.agent.guardrailKeywords)) {
    return failPipeline(
      context,
      "Composed reply contains a word or phrase this category's guardrail forbids — refusing to propose sending it.",
    );
  }

  return proposeAction(context, {
    toolName: await resolveActionTool(
      context.agent.actionTool,
      context.organisationId,
      context.agent.actionIntegrationId,
    ),
    args: {
      to: email,
      subject: context.agent.replySubjectTemplate ?? "Re: your message",
      body,
    },
  });
};
