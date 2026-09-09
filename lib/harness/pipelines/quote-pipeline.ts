import { z } from "zod";

import { composeReply } from "@/lib/harness/compose-reply";
import {
  composeBaseInstructions,
  withBusinessGuidance,
} from "@/lib/harness/compose-instructions";
import { currencySymbol } from "@/lib/currency/currency-symbols";
import { extractFields } from "@/lib/harness/extract-fields";
import {
  callTool,
  extractEmailDeterministically,
} from "@/lib/harness/pipeline-helpers";
import { failPipeline } from "@/lib/harness/pipeline-failure";
import { proposeAction, resolveActionTool } from "@/lib/harness/propose-action";
import type { Pipeline } from "@/lib/harness/types";

const fieldsSchema = z.object({
  product: z.string().nullable(),
  quantity: z.number().nullable(),
  customerEmail: z.string().nullable(),
});

interface ResolvedRecord {
  id: string;
  type: string;
  data: Record<string, unknown>;
}

/**
 * The Quote Agent's job is almost entirely deterministic: given a product
 * and quantity, look up the customer and product, price it, and propose a
 * reply. There's no real decision happening in that sequence — it was only
 * ever a "decision" in LOOP mode because the model had to re-derive it
 * turn by turn, which is exactly where the aborted-tool-call bugs came
 * from. Here it's just code.
 *
 * Pricing is arithmetic done inline rather than through a tool. There used
 * to be a `calculate_quote` tool doing exactly this multiplication, but
 * multiplying two numbers this pipeline already holds is not a
 * *capability* an agent needs granting — it was a vertical concept
 * occupying a slot in a registry every business has to read (CLAUDE.md
 * §3, §4.5). Stock is likewise just a field on the product record now,
 * rather than a separate check_inventory round-trip whose result this
 * pipeline discarded anyway.
 */
export const runQuotePipeline: Pipeline = async (context) => {
  const fields = await extractFields(
    context,
    'Extract fields from the message as JSON: {"product": string or null, "quantity": number or null, "customerEmail": string or null}. Use null for anything not present in the message. Output ONLY the JSON object, no other text.',
    fieldsSchema,
  );

  if (!fields || !fields.product || !fields.quantity) {
    return failPipeline(
      context,
      "Could not extract a clear product and quantity from the request.",
    );
  }

  const email =
    context.senderEmail ??
    extractEmailDeterministically(context.input) ??
    fields.customerEmail;

  let customerName: string | null = null;
  if (email) {
    const customerResult = await callTool(context, "find_record", {
      recordType: "Customer",
      field: "email",
      value: email,
    });
    if (!customerResult.isError && customerResult.structuredContent?.found) {
      const record = customerResult.structuredContent
        .record as ResolvedRecord | null;
      const name = record?.data.name;
      customerName = typeof name === "string" ? name : null;
    }
  }

  const productResult = await callTool(context, "search_records", {
    recordType: "Product",
    query: fields.product,
  });
  const productRecord = productResult.isError
    ? null
    : ((
        productResult.structuredContent?.records as ResolvedRecord[] | undefined
      )?.[0] ?? null);
  if (!productRecord) {
    return failPipeline(
      context,
      `Could not find a product matching "${fields.product}".`,
    );
  }

  const productName = String(productRecord.data.name ?? fields.product);
  const unitPrice = Number(productRecord.data.unitPrice);
  if (!Number.isFinite(unitPrice)) {
    return failPipeline(
      context,
      `Product "${productName}" has no usable unit price to quote from.`,
    );
  }
  // Rounded to whole pence rather than left as a raw float — the same
  // reasoning that makes Product.unitPrice a Decimal in the schema.
  const total = Math.round(unitPrice * fields.quantity * 100) / 100;
  const stockQuantity = Number(productRecord.data.stockQuantity);

  if (!email) {
    return failPipeline(
      context,
      "No customer email address to send the quote to.",
    );
  }

  const symbol = currencySymbol(context.organisation.currency);
  const body = await composeReply(
    context,
    withBusinessGuidance(
      `${composeBaseInstructions(context.organisation.name)} Write a short, professional email body quoting a customer a price, given the facts below. Do not include a subject line, just the body text.`,
      context.agent,
    ),
    [
      customerName
        ? `Customer: ${customerName}`
        : 'Customer name: unknown — do not invent or placeholder one, open with "Hello,"',
      `Product: ${productName}`,
      `Quantity: ${fields.quantity}`,
      `Unit price: ${symbol}${unitPrice}`,
      `Total: ${symbol}${total}`,
      Number.isFinite(stockQuantity)
        ? `Units currently in stock: ${stockQuantity}`
        : null,
    ]
      .filter((line): line is string => line !== null)
      .join("\n"),
  );

  return proposeAction(context, {
    toolName: await resolveActionTool(
      context.agent.actionTool,
      context.organisationId,
      context.agent.actionIntegrationId,
    ),
    args: {
      to: email,
      subject: `Quote for ${fields.quantity} x ${productName}`,
      body,
    },
  });
};
