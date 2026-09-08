import type { StepProgramme } from "@/lib/harness/steps/schema";

/**
 * The starting points a business can install onto a new agent.
 *
 * Every one of these is a *vertical* — a specific business process — and
 * that is exactly why they live here as data rather than as category
 * options in the agent form (CLAUDE.md §3: a vertical is a template, never
 * a primitive). "Lookup & Quote" used to be a first-class choice every
 * unrelated business had to scroll past; now it's one row in this list that
 * a takeaway or a landlord simply never installs.
 *
 * Seeded into AgentTemplate with a null organisationId, meaning available
 * to everyone. A business can also save its own, which is why the table is
 * rows rather than these constants being the whole story.
 *
 * Each is a complete, runnable step programme — installing one and pressing
 * save must produce an agent that works, not a skeleton to fill in.
 */

export interface BuiltInTemplate {
  key: string;
  name: string;
  description: string;
  // Both omitted means "steps" + the generic install-time wrapper — every
  // template below is exactly that, unchanged from before these existed.
  categoryType?: string;
  instructions?: string;
  steps: StepProgramme;
  suggestedTools: string[];
}

export const BUILT_IN_TEMPLATES: BuiltInTemplate[] = [
  {
    key: "acknowledge_reply",
    name: "Acknowledge and reply",
    description:
      "Read an inbound message, pull out what matters, look up the sender, and write a reply. The send waits for approval. Good starting point for enquiries, complaints, and most 'read it and respond' work.",
    suggestedTools: ["find_record", "send_email"],
    steps: {
      steps: [
        {
          kind: "extract",
          fields: [
            {
              name: "summary",
              description: "a one-sentence summary of what they are asking",
            },
          ],
        },
        {
          kind: "lookup",
          as: "customer",
          recordType: "Customer",
          match: { by: "field", field: "email", value: "{senderEmail}" },
          required: false,
        },
        {
          kind: "compose",
          as: "body",
          instructions:
            "Reply to the customer's message. Acknowledge their point specifically rather than generically, and say what happens next.",
          facts: ["summary", "customer"],
        },
        {
          kind: "act",
          tool: "send_email",
          args: {
            to: "{senderEmail}",
            subject: "Re: your enquiry",
            body: "{body}",
          },
        },
      ],
    },
  },
  {
    key: "quote",
    name: "Look up and quote",
    description:
      "Find a product from what the customer asked for, price it against your catalog, and send a quote. The send waits for approval.",
    suggestedTools: ["find_record", "search_records", "send_email"],
    steps: {
      steps: [
        {
          kind: "extract",
          fields: [
            {
              name: "product",
              description: "the product they are asking about",
            },
            { name: "quantity", description: "how many units they want" },
          ],
        },
        {
          kind: "lookup",
          as: "customer",
          recordType: "Customer",
          match: { by: "field", field: "email", value: "{senderEmail}" },
          required: false,
        },
        {
          kind: "lookup",
          as: "item",
          recordType: "Product",
          // first: true — the compute step below needs a single record
          // ({item.data.unitPrice}), not the array a plain search binds.
          // Without it this step ran, found the product, and then failed
          // at compute with "not a number", since resolvePath() refuses to
          // index into an array by design (see values.ts).
          match: { by: "search", query: "{product}", first: true },
          required: true,
        },
        {
          kind: "compute",
          as: "total",
          operation: "multiply",
          operands: ["{item.data.unitPrice}", "{quantity}"],
        },
        {
          kind: "compose",
          as: "body",
          instructions:
            "Write a short, professional email quoting this price. State the product, quantity and total plainly.",
          facts: ["product", "quantity", "total", "customer"],
        },
        {
          kind: "act",
          tool: "send_email",
          args: {
            to: "{senderEmail}",
            subject: "Your quote",
            body: "{body}",
          },
        },
      ],
    },
  },
  {
    key: "file_as_record",
    name: "File an email as a record",
    description:
      "Pull details out of an inbound email and save them as a record — invoices, orders, applications. One LLM call, no reply sent.",
    suggestedTools: ["create_record"],
    steps: {
      steps: [
        {
          kind: "extract",
          fields: [
            {
              name: "reference",
              description: "the reference or document number",
            },
            {
              name: "amount",
              description: "the total amount, if there is one",
            },
          ],
        },
        {
          kind: "act",
          tool: "create_record",
          args: {
            recordType: "Invoice",
            data: { number: "{reference}", total: "{amount}" },
          },
        },
      ],
    },
  },
  {
    key: "answer_from_knowledge",
    name: "Answer from your documented knowledge",
    description:
      "Look the question up in your own policies and procedures, then answer using only what was found. Keeps replies consistent with what you've actually written down.",
    suggestedTools: ["search_knowledge", "send_email"],
    steps: {
      steps: [
        {
          kind: "extract",
          fields: [
            { name: "question", description: "what the customer is asking" },
          ],
        },
        {
          kind: "retrieve",
          as: "policy",
          query: "{question}",
          limit: 3,
        },
        {
          kind: "compose",
          as: "body",
          instructions:
            "Answer the customer's question using only the policy passages provided. If they don't cover it, say a colleague will follow up rather than guessing.",
          facts: ["question", "policy"],
        },
        {
          kind: "act",
          tool: "send_email",
          args: {
            to: "{senderEmail}",
            subject: "Re: your question",
            body: "{body}",
          },
        },
      ],
    },
  },
];
