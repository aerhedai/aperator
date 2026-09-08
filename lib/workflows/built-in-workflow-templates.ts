import {
  DEFAULT_COMPLAINTS_EXTRACTION_FIELDS,
  DEFAULT_COMPLAINTS_GUARDRAIL_KEYWORDS,
  DEFAULT_COMPLAINTS_KEYWORDS,
  DEFAULT_GENERAL_EXTRACTION_FIELDS,
  DEFAULT_QUOTE_KEYWORDS,
} from "@/lib/agents/default-agent-config";
import type { WorkflowTemplateHandler } from "@/lib/workflows/workflow-template-types";

// Every classifier below shares this instruction — selectHandler's own
// classifyIntent call appends the real candidate list at classification
// time (lib/routing/classify-intent.ts), so this is only ever the prefix,
// and one proven wording works for any department.
const DEFAULT_CLASSIFIER_INSTRUCTIONS =
  "Classify the inbound message against the specialist agents listed below, based only on their descriptions. If none clearly fit, say so — never guess.";

export interface BuiltInWorkflowTemplate {
  key: string;
  name: string;
  description: string;
  classifierInstructions: string;
  handlers: WorkflowTemplateHandler[];
  // Names from lib/records/starter-record-types.ts this template's
  // handlers need — seeded once at install time.
  recordTypes: string[];
}

/**
 * The starting departments a business can install as a whole, working
 * unit — a classifier plus its handler agents, immediately reachable from
 * chat via invoke_workflow (unlike a lone AgentTemplate, which installs as
 * a DRAFT agent nothing points at yet). Deliberately a mix of breadth:
 * "Customer Enquiries" bundles three handlers behind one classifier, the
 * rest are single-handler departments — a department doesn't have to be
 * broad to be worth installing as its own addressable unit (CLAUDE.md §6:
 * templates are starting points, not constraints — a business can always
 * add more handlers under any of these afterwards).
 */
export const BUILT_IN_WORKFLOW_TEMPLATES: BuiltInWorkflowTemplate[] = [
  {
    key: "customer_enquiries",
    name: "Customer Enquiries",
    description:
      "Routes inbound customer messages to the right specialist: quotes, complaints, or general questions.",
    classifierInstructions: DEFAULT_CLASSIFIER_INSTRUCTIONS,
    recordTypes: ["Product", "Customer"],
    handlers: [
      {
        name: "Quote Handler",
        description:
          "Handles requests for a price quote — calculating and sending pricing for a specific product and quantity.",
        categoryType: "quote",
        instructions:
          "A customer is asking for a price quote. Extract the product and quantity, look up the customer and product, calculate the total, then send the quote by email.",
        suggestedTools: ["find_record", "search_records", "send_email"],
        keywords: DEFAULT_QUOTE_KEYWORDS,
      },
      {
        name: "Complaints Handler",
        description:
          "Handles complaints or expressions of dissatisfaction from a customer about a product, order, or service they've received.",
        categoryType: "acknowledge_reply",
        instructions:
          "A customer has a complaint. Acknowledge their concern specifically, never promise compensation, and let them know a team member will follow up.",
        suggestedTools: ["find_record", "send_email"],
        keywords: DEFAULT_COMPLAINTS_KEYWORDS,
        extractionFields: DEFAULT_COMPLAINTS_EXTRACTION_FIELDS,
        guardrailKeywords: DEFAULT_COMPLAINTS_GUARDRAIL_KEYWORDS,
      },
      {
        name: "General Inquiry Handler",
        description:
          "Handles general questions that are not a price quote request and not a complaint — e.g. asking about opening hours, delivery times, or how to place an order.",
        categoryType: "acknowledge_reply",
        instructions:
          "Answer the inquiry helpfully and directly. If there isn't enough information to answer accurately, say so rather than guessing.",
        suggestedTools: ["find_record", "send_email"],
        keywords: [],
        extractionFields: DEFAULT_GENERAL_EXTRACTION_FIELDS,
      },
    ],
  },
  {
    key: "meeting_scheduling",
    name: "Meeting Scheduling",
    description:
      "Finds a real open time and books a meeting — checks availability before ever proposing a slot.",
    classifierInstructions: DEFAULT_CLASSIFIER_INSTRUCTIONS,
    recordTypes: [],
    handlers: [
      {
        name: "Meeting Scheduler",
        description:
          "Schedules a meeting: checks real calendar availability, agrees a time, and books it.",
        categoryType: "loop",
        instructions:
          "Help schedule a meeting. Extract who wants to meet, with whom, and roughly when. Use check_calendar_availability to find real open slots before proposing a time — never invent availability. Once a specific time is agreed, use create_calendar_event to book it and invite the attendees. If you can't find a suitable time, say so plainly rather than guessing.",
        suggestedTools: [
          "check_calendar_availability",
          "create_calendar_event",
          "send_email",
        ],
      },
    ],
  },
  {
    key: "lead_intake",
    name: "Lead Intake",
    description:
      "Takes down a new enquiry's details and logs it as a Lead, ready to follow up on.",
    classifierInstructions: DEFAULT_CLASSIFIER_INSTRUCTIONS,
    recordTypes: ["Lead"],
    handlers: [
      {
        name: "Lead Intake",
        description:
          "Logs a new enquiry as a Lead — their name, contact email, and what they're interested in.",
        categoryType: "steps",
        instructions: "",
        suggestedTools: ["create_record"],
        steps: {
          steps: [
            {
              kind: "extract",
              fields: [
                { name: "name", description: "the enquirer's full name" },
                { name: "email", description: "their contact email" },
                {
                  name: "interest",
                  description: "what they're enquiring about",
                },
              ],
            },
            {
              kind: "act",
              tool: "create_record",
              args: {
                recordType: "Lead",
                data: {
                  name: "{name}",
                  email: "{email}",
                  interest: "{interest}",
                },
              },
            },
          ],
        },
      },
    ],
  },
  {
    key: "document_requests",
    name: "Document Requests",
    description:
      "Fills in a business's own .docx template with real details and files the result — point templatePath/outputPath at your own file after installing.",
    classifierInstructions: DEFAULT_CLASSIFIER_INSTRUCTIONS,
    recordTypes: [],
    handlers: [
      {
        name: "Document Generator",
        description:
          "Fills a .docx template with the request's details and saves it to connected storage. Edit templatePath/outputPath below to point at your own template file.",
        categoryType: "steps",
        instructions: "",
        suggestedTools: ["populate_template"],
        steps: {
          steps: [
            {
              kind: "extract",
              fields: [
                {
                  name: "recipientName",
                  description: "who this document is for",
                },
                {
                  name: "referenceNumber",
                  description: "a reference number or code for this request",
                },
                {
                  name: "details",
                  description:
                    "a short summary of what the document should cover",
                },
              ],
            },
            {
              kind: "act",
              tool: "populate_template",
              args: {
                provider: "google-drive",
                templatePath: ["Templates", "document-template.docx"],
                outputPath: ["Generated Documents"],
                outputFilename: "{referenceNumber}.docx",
                data: {
                  recipientName: "{recipientName}",
                  referenceNumber: "{referenceNumber}",
                  details: "{details}",
                },
              },
            },
          ],
        },
      },
    ],
  },
  {
    key: "team_escalation",
    name: "Team Escalation",
    description:
      "Flags something that needs a human's attention to your team's chat channel — point it at your own channel after installing.",
    classifierInstructions: DEFAULT_CLASSIFIER_INSTRUCTIONS,
    recordTypes: [],
    handlers: [
      {
        name: "Escalate to Team",
        description:
          "Summarises what needs attention and posts it to your team's Slack or Teams channel. Edit the channel below to point at your own.",
        categoryType: "steps",
        instructions: "",
        suggestedTools: ["notify_channel"],
        steps: {
          steps: [
            {
              kind: "extract",
              fields: [
                {
                  name: "summary",
                  description:
                    "a short summary of what needs attention and why",
                },
              ],
            },
            {
              kind: "act",
              tool: "notify_channel",
              args: {
                platform: "slack",
                channel: "#general",
                message: "Needs attention: {summary}",
              },
            },
          ],
        },
      },
    ],
  },
  {
    key: "order_booking_confirmation",
    name: "Order & Booking Confirmation",
    description:
      "Looks up or logs a booking/order and sends the customer a confirmation email.",
    classifierInstructions: DEFAULT_CLASSIFIER_INSTRUCTIONS,
    recordTypes: ["Booking"],
    handlers: [
      {
        name: "Booking Confirmation",
        description:
          "Confirms a booking or order: looks up an existing one by reference if mentioned, otherwise logs a new one, then emails a confirmation.",
        categoryType: "loop",
        instructions:
          "A customer is asking about or providing details for a booking or order. Extract the reference and relevant details (customer name, date). If a Booking record with that reference already exists, look it up and update its status to Confirmed; otherwise create a new Booking record with status Confirmed. Then send the customer a short confirmation email summarising what's been booked.",
        suggestedTools: [
          "find_record",
          "create_record",
          "update_record",
          "send_email",
        ],
      },
    ],
  },
];
