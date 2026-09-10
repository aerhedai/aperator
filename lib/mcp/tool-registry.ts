// The single canonical list of valid tool names — previously scattered as
// string literals across lib/mcp/server.ts, each tool file's own `name`
// field, and AgentTool.toolName values with nothing tying them together.
// Every tool file imports its name from here; the agent-tool UI (which
// tools a business can grant an agent) and its Zod validation both read
// from this list too, so a submitted tool name that isn't real can't reach
// the database.
//
// This list is deliberately small, fixed, and reviewable, and it must not
// grow with every concept a business defines (CLAUDE.md §4.5). That is why
// there is one `find_record` taking a record type as a *parameter* rather
// than a find_customer/find_product/find_job/... per type, and why business
// data tools are verbs against primitives ("find a record") rather than
// against verticals ("calculate a quote").
//
// Provider-specific action tools (GMAIL_SEND_EMAIL, SLACK_POST_MESSAGE, ...)
// are the deliberate exception, in UPPER_SNAKE_CASE to make that visible at
// a glance — see docs/provider-specific-tools-design.md for why one clean
// tool per provider per capability replaced a single tool that branched
// internally on which provider was connected.
export const TOOL_REGISTRY = [
  {
    name: "find_record",
    group: "Business data",
    label: "Find record",
    description:
      "Find a single record of any type by an exact field match — customers, products, or any record type this business has defined.",
  },
  {
    name: "search_records",
    group: "Business data",
    label: "Search records",
    description:
      "Search records of one type by approximate text, for when only an approximate name is known.",
  },
  {
    name: "create_record",
    group: "Business data",
    label: "Create record",
    description: "Create a new record of one of this business's record types.",
  },
  {
    name: "update_record",
    group: "Business data",
    label: "Update record",
    description:
      "Update fields on an existing record, leaving its other fields untouched.",
  },
  {
    name: "search_knowledge",
    group: "Business data",
    label: "Search knowledge",
    description:
      "Look something up in this business's own documented knowledge — policies, procedures, price lists, FAQs.",
  },
  {
    name: "GMAIL_READ_INBOX",
    group: "Gmail",
    provider: "gmail",
    label: "Read inbox",
    description:
      "List unread messages waiting in the connected Gmail inbox, with their full content.",
  },
  {
    name: "GMAIL_SEND_EMAIL",
    group: "Gmail",
    provider: "gmail",
    label: "Send email",
    description:
      "Send an email reply via the connected Gmail account — always requires approval.",
  },
  {
    name: "OUTLOOK_READ_INBOX",
    group: "Outlook",
    provider: "outlook",
    label: "Read inbox",
    description:
      "List unread messages waiting in the connected Outlook inbox, with their full content.",
  },
  {
    name: "OUTLOOK_SEND_EMAIL",
    group: "Outlook",
    provider: "outlook",
    label: "Send email",
    description:
      "Send an email reply via the connected Outlook account — always requires approval.",
  },
  {
    name: "SLACK_POST_MESSAGE",
    group: "Slack",
    provider: "slack",
    label: "Post message",
    description:
      "Post an internal notification to a Slack channel, to alert a human that something needs attention.",
  },
  {
    name: "TEAMS_POST_MESSAGE",
    group: "Teams",
    provider: "teams",
    label: "Post message",
    description:
      "Post an internal notification to a Microsoft Teams channel — posts as whichever person connected the account.",
  },
  {
    name: "OUTLOOK_CHECK_CALENDAR_AVAILABILITY",
    group: "Outlook Calendar",
    // A distinct Integration.provider from OUTLOOK_SEND_EMAIL's "outlook"
    // despite the shared name prefix — Outlook Mail and Outlook Calendar
    // are separate OAuth connections (see lib/integrations/outlook-calendar/).
    provider: "outlook-calendar",
    label: "Check calendar availability",
    description:
      "Find suggested meeting times for a set of attendees using the connected Outlook Calendar.",
  },
  {
    name: "OUTLOOK_CREATE_CALENDAR_EVENT",
    group: "Outlook Calendar",
    provider: "outlook-calendar",
    label: "Create calendar event",
    description:
      "Create a real Outlook Calendar event and invite attendees — always requires approval.",
  },
  {
    name: "GOOGLE_DRIVE_CREATE_FOLDER",
    group: "Google Drive",
    provider: "google-drive",
    label: "Create folder",
    description:
      "Create (or reuse) a nested folder path in the business's connected Google Drive.",
  },
  {
    name: "GOOGLE_DRIVE_SAVE_FILE",
    group: "Google Drive",
    provider: "google-drive",
    label: "Save file",
    description:
      "Save a file into the business's connected Google Drive, creating the folder path if needed.",
  },
  {
    name: "GOOGLE_DRIVE_POPULATE_TEMPLATE",
    group: "Google Drive",
    provider: "google-drive",
    label: "Populate document template",
    description:
      "Fill a business's .docx template with real data and save the result to their connected Google Drive.",
  },
  {
    name: "SHAREPOINT_CREATE_FOLDER",
    group: "SharePoint",
    provider: "sharepoint",
    label: "Create folder",
    description:
      "Create (or reuse) a nested folder path in the business's connected SharePoint site.",
  },
  {
    name: "SHAREPOINT_SAVE_FILE",
    group: "SharePoint",
    provider: "sharepoint",
    label: "Save file",
    description:
      "Save a file into the business's connected SharePoint site, creating the folder path if needed.",
  },
  {
    name: "SHAREPOINT_POPULATE_TEMPLATE",
    group: "SharePoint",
    provider: "sharepoint",
    label: "Populate document template",
    description:
      "Fill a business's .docx template with real data and save the result to their connected SharePoint site.",
  },
  {
    name: "list_invokable",
    group: "Orchestration",
    label: "List invokable agents and workflows",
    description:
      "See exactly which agents and departments are currently active and invokable, right now.",
  },
  {
    name: "invoke_agent",
    group: "Orchestration",
    label: "Invoke agent",
    description:
      "Delegate a task to another agent this one has been explicitly granted access to invoke.",
  },
  {
    name: "invoke_workflow",
    group: "Orchestration",
    label: "Invoke workflow",
    description:
      "Ask a workflow's own classifier to decide which of its agents should handle something.",
  },
  {
    name: "list_templates",
    group: "Orchestration",
    label: "List templates",
    description:
      "See which pre-built agent templates are available to install for this organisation.",
  },
  {
    name: "install_template",
    group: "Orchestration",
    label: "Install template",
    description:
      "Install a pre-built agent template, creating a real (draft) agent from it.",
  },
  {
    name: "install_workflow_template",
    group: "Orchestration",
    label: "Install workflow template",
    description:
      "Install a pre-built department (a classifier plus its handlers), creating a real, active workflow from it.",
  },
  {
    name: "create_task",
    group: "Orchestration",
    label: "Create task",
    description:
      "Create and immediately run a trackable one-off task made of one or more agent/workflow steps.",
  },
  {
    name: "create_routine",
    group: "Orchestration",
    label: "Create routine",
    description:
      "Create a recurring routine — the same kind of plan as a task, but saved on a schedule instead of run immediately.",
  },
] as const;

export type ToolName = (typeof TOOL_REGISTRY)[number]["name"];

// The order groups appear in the agent form. Declared here rather than
// derived from TOOL_REGISTRY's order so the UI grouping is explicit and
// stable even if a tool is inserted mid-list.
export const TOOL_GROUPS = [
  "Business data",
  "Gmail",
  "Outlook",
  "Slack",
  "Teams",
  "Outlook Calendar",
  "Google Drive",
  "SharePoint",
  "Orchestration",
] as const;

export const TOOL_NAMES = TOOL_REGISTRY.map((t) => t.name) as [
  ToolName,
  ...ToolName[],
];

// Only provider-specific tools declare `provider` — undefined for every
// primitive/orchestration tool, which has no single connected account it
// belongs to. Used by agent-service.ts's cross-check (a granted tool's
// provider must match its agent's bound account) and will be reused by
// scope-based tool availability (docs/provider-specific-tools-design.md).
export function getToolProvider(toolName: string): string | undefined {
  const tool = TOOL_REGISTRY.find((t) => t.name === toolName);
  return tool && "provider" in tool ? tool.provider : undefined;
}
