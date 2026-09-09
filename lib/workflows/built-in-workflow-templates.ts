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
 * chat via invoke_workflow.
 *
 * A rule governs this list, learned from an earlier version of it that
 * shipped five "departments" with exactly one handler each: a classifier
 * that only ever has one possible answer isn't classifying anything — it's
 * a real Agent row created, activated, and then never consulted
 * (selectHandler short-circuits straight past it). A department earns the
 * classifier's existence only when 2+ handlers are genuine alternatives
 * for the *same kind* of inbound request. Every department below has
 * exactly that: two specialists whose difference is a real decision, not
 * a formality. The five single-handler departments this list used to have
 * (Meeting Scheduling, Lead Intake, Document Requests, Team Escalation,
 * Order & Booking Confirmation) were each paired off into one of the real
 * departments below instead — every one of those five turned out to have
 * a genuine sibling task once looked at again (e.g. "book a meeting" and
 * "confirm a booking" are two different real requests, not the same
 * capability twice). A capability that genuinely has no such sibling
 * belongs in built-in-templates.ts as a plain agent instead.
 */
export const BUILT_IN_WORKFLOW_TEMPLATES: BuiltInWorkflowTemplate[] = [
  {
    key: "sales_enquiries",
    name: "Sales & Enquiries",
    description:
      "Routes new business: a vague first-touch enquiry becomes a Lead, a concrete pricing request becomes a quote.",
    classifierInstructions: DEFAULT_CLASSIFIER_INSTRUCTIONS,
    recordTypes: ["Lead", "Product", "Customer"],
    handlers: [
      {
        name: "Lead Qualifier",
        description:
          "Logs a new, not-yet-specific enquiry as a Lead — their name, contact email, and what they're interested in. The catch-all for anything that isn't a concrete quote request.",
        categoryType: "steps",
        instructions: "",
        suggestedTools: ["create_record"],
        // No keywords — this is the fallback when nothing names a
        // specific product/quantity the way a quote request does.
        keywords: [],
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
      {
        name: "Quote Specialist",
        description:
          "Handles requests for a price quote — calculating and sending pricing for a specific product and quantity.",
        categoryType: "quote",
        instructions:
          "A customer is asking for a price quote. Extract the product and quantity, look up the customer and product, calculate the total, then send the quote by email.",
        suggestedTools: [
          "find_record",
          "search_records",
          "GMAIL_SEND_EMAIL",
          "OUTLOOK_SEND_EMAIL",
        ],
        keywords: DEFAULT_QUOTE_KEYWORDS,
      },
    ],
  },
  {
    key: "customer_support",
    name: "Customer Support",
    description:
      "Routes post-purchase customer messages: a complaint gets acknowledged carefully, everything else gets answered directly.",
    classifierInstructions: DEFAULT_CLASSIFIER_INSTRUCTIONS,
    recordTypes: ["Customer"],
    handlers: [
      {
        name: "Complaints Handler",
        description:
          "Handles complaints or expressions of dissatisfaction from a customer about a product, order, or service they've received.",
        categoryType: "acknowledge_reply",
        instructions:
          "A customer has a complaint. Acknowledge their concern specifically, never promise compensation, and let them know a team member will follow up.",
        suggestedTools: [
          "find_record",
          "GMAIL_SEND_EMAIL",
          "OUTLOOK_SEND_EMAIL",
        ],
        keywords: DEFAULT_COMPLAINTS_KEYWORDS,
        extractionFields: DEFAULT_COMPLAINTS_EXTRACTION_FIELDS,
        guardrailKeywords: DEFAULT_COMPLAINTS_GUARDRAIL_KEYWORDS,
      },
      {
        name: "General Inquiry Handler",
        description:
          "Handles general questions that are not a complaint — opening hours, delivery times, how to place an order, anything else.",
        categoryType: "acknowledge_reply",
        instructions:
          "Answer the inquiry helpfully and directly. If there isn't enough information to answer accurately, say so rather than guessing.",
        suggestedTools: [
          "find_record",
          "GMAIL_SEND_EMAIL",
          "OUTLOOK_SEND_EMAIL",
        ],
        keywords: [],
        extractionFields: DEFAULT_GENERAL_EXTRACTION_FIELDS,
      },
    ],
  },
  {
    key: "scheduling_bookings",
    name: "Scheduling & Bookings",
    description:
      "Routes real calendar work: booking a meeting is a different job from confirming an order, and each needs its own tool sequence.",
    classifierInstructions: DEFAULT_CLASSIFIER_INSTRUCTIONS,
    recordTypes: ["Booking"],
    handlers: [
      {
        name: "Meeting Scheduler",
        description:
          "Schedules a meeting or call: checks real calendar availability, agrees a time, and books it.",
        // A fixed step sequence can't express this — `act` is always
        // terminal (steps/schema.ts), so a process that has to check
        // something and *then* decide what to do next genuinely needs a
        // real tool-calling loop, not a workaround.
        categoryType: "loop",
        instructions:
          "Help schedule a meeting or call. Extract who wants to meet, with whom, and roughly when. Use OUTLOOK_CHECK_CALENDAR_AVAILABILITY to find real open slots before proposing a time — never invent availability. Once a specific time is agreed, use OUTLOOK_CREATE_CALENDAR_EVENT to book it and invite the attendees. If you can't find a suitable time, say so plainly rather than guessing.",
        suggestedTools: [
          "OUTLOOK_CHECK_CALENDAR_AVAILABILITY",
          "OUTLOOK_CREATE_CALENDAR_EVENT",
          "GMAIL_SEND_EMAIL",
          "OUTLOOK_SEND_EMAIL",
        ],
        keywords: ["meeting", "call", "schedule a time", "calendar invite"],
      },
      {
        name: "Booking Coordinator",
        description:
          "Confirms a booking or order: looks up an existing one by reference if mentioned, otherwise logs a new one, then emails a confirmation.",
        // Also genuinely loop-shaped: look up (maybe), then create or
        // update, then send a confirmation — two consequential actions in
        // sequence, which one terminal `act` step cannot express either.
        categoryType: "loop",
        instructions:
          "A customer is asking about or providing details for a booking or order. Extract the reference and relevant details (customer name, date). If a Booking record with that reference already exists, look it up and update its status to Confirmed; otherwise create a new Booking record with status Confirmed. Then send the customer a short confirmation email summarising what's been booked.",
        suggestedTools: [
          "find_record",
          "create_record",
          "update_record",
          "GMAIL_SEND_EMAIL",
          "OUTLOOK_SEND_EMAIL",
        ],
        keywords: ["booking", "reservation", "confirm my order"],
      },
    ],
  },
  {
    key: "document_records",
    name: "Document & Records",
    description:
      "Routes document work: generating an outbound document is a different job from filing an inbound one.",
    classifierInstructions: DEFAULT_CLASSIFIER_INSTRUCTIONS,
    recordTypes: ["Invoice"],
    handlers: [
      {
        name: "Document Generator",
        description:
          "Fills a .docx template with the request's details and saves it to connected storage. Edit templatePath/outputPath below to point at your own template file.",
        categoryType: "steps",
        instructions: "",
        suggestedTools: ["GOOGLE_DRIVE_POPULATE_TEMPLATE"],
        keywords: ["document", "letter", "certificate", "generate"],
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
              tool: "GOOGLE_DRIVE_POPULATE_TEMPLATE",
              args: {
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
      {
        name: "Record Filer",
        description:
          "Pulls details out of an inbound invoice, order, or application and files it as a record — no reply sent.",
        categoryType: "steps",
        instructions: "",
        suggestedTools: ["create_record"],
        keywords: ["invoice", "receipt", "purchase order"],
        steps: {
          steps: [
            {
              kind: "extract",
              fields: [
                {
                  name: "reference",
                  description: "the invoice or reference number",
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
    ],
  },
  {
    key: "people_internal_requests",
    name: "People & Internal Requests",
    description:
      "Routes internal questions: anything covered by documented policy gets answered directly, everything else gets flagged to the team.",
    classifierInstructions: DEFAULT_CLASSIFIER_INSTRUCTIONS,
    recordTypes: [],
    handlers: [
      {
        name: "Policy Q&A Handler",
        description:
          "Looks a question up in the business's own documented policies and procedures, then answers using only what was found. The catch-all for anything that isn't clearly urgent.",
        categoryType: "steps",
        instructions: "",
        suggestedTools: ["search_knowledge", "GMAIL_SEND_EMAIL"],
        // No keywords — try to answer from documented knowledge before
        // ever escalating to a human.
        keywords: [],
        steps: {
          steps: [
            {
              kind: "extract",
              fields: [{ name: "question", description: "what's being asked" }],
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
                "Answer the question using only the policy passages provided. If they don't cover it, say a colleague will follow up rather than guessing.",
              facts: ["question", "policy"],
            },
            {
              kind: "act",
              // Defaults to Gmail — a step's tool must be a real,
              // already-registered name, so it can't resolve dynamically
              // the way Agent.actionTool does (see built-in-templates.ts's
              // own comment on this). Edit to OUTLOOK_SEND_EMAIL after
              // installing if this business uses Outlook instead.
              tool: "GMAIL_SEND_EMAIL",
              args: {
                to: "{senderEmail}",
                subject: "Re: your question",
                body: "{body}",
              },
            },
          ],
        },
      },
      {
        name: "Escalate to Team",
        description:
          "Summarises something that needs a human's attention and posts it to your team's Slack or Teams channel. Edit the channel below to point at your own.",
        categoryType: "steps",
        instructions: "",
        suggestedTools: ["SLACK_POST_MESSAGE"],
        keywords: ["urgent", "escalate", "speak to someone", "need a person"],
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
              tool: "SLACK_POST_MESSAGE",
              args: {
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
    key: "onboarding",
    name: "Onboarding",
    description:
      "Routes new-arrival setup: getting a new customer going is a different process from getting a new employee going.",
    classifierInstructions: DEFAULT_CLASSIFIER_INSTRUCTIONS,
    recordTypes: ["Customer"],
    handlers: [
      {
        name: "New Customer Setup",
        description:
          "Sets up a new customer: logs their details as a Customer record and sends them a welcome email.",
        // Loop, not steps — needs two real actions in sequence (log the
        // record, then email them), which a HARNESS step programme's
        // single terminal `act` step can't do in one run.
        categoryType: "loop",
        instructions:
          "A new customer needs setting up. Extract their name, email, and company if mentioned. Create a Customer record with those details, then send them a short, friendly welcome email confirming they're set up.",
        suggestedTools: [
          "create_record",
          "GMAIL_SEND_EMAIL",
          "OUTLOOK_SEND_EMAIL",
        ],
        keywords: ["new customer", "sign up", "sign me up", "get started"],
      },
      {
        name: "New Employee Setup",
        description:
          "Sets up a new employee: creates their folder in shared storage and lets the team know someone new is starting.",
        // Also genuinely loop-shaped — create the folder, then notify the
        // team, two sequenced actions.
        categoryType: "loop",
        instructions:
          "A new employee is starting. Extract their name and start date if mentioned. Create a folder for them in shared storage, then post a notification to the team channel letting them know who's starting and when.",
        suggestedTools: [
          "GOOGLE_DRIVE_CREATE_FOLDER",
          "SHAREPOINT_CREATE_FOLDER",
          "SLACK_POST_MESSAGE",
          "TEAMS_POST_MESSAGE",
        ],
        keywords: [
          "new employee",
          "new hire",
          "new starter",
          "onboarding",
          "joining the team",
        ],
      },
    ],
  },
];
