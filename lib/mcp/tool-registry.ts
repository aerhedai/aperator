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
// than a find_customer/find_product/find_job/... per type, and why tools
// are verbs against primitives ("find a record", "notify a channel")
// rather than against verticals ("calculate a quote").
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
    name: "send_email",
    group: "Communication",
    label: "Send email",
    description:
      "Send an email reply via whichever email account is connected (Gmail or Outlook) — always requires approval.",
  },
  {
    name: "notify_channel",
    group: "Communication",
    label: "Notify chat channel",
    description:
      "Post an internal notification to a Slack or Microsoft Teams channel, to alert a human that something needs attention.",
  },
  {
    name: "check_calendar_availability",
    group: "Calendar",
    label: "Check calendar availability",
    description:
      "Find suggested meeting times for a set of attendees using the connected Outlook Calendar.",
  },
  {
    name: "create_calendar_event",
    group: "Calendar",
    label: "Create calendar event",
    description:
      "Create a real Outlook Calendar event and invite attendees — always requires approval.",
  },
  {
    name: "create_folder",
    group: "Files",
    label: "Create folder",
    description:
      "Create (or reuse) a nested folder path in the business's connected Google Drive or SharePoint.",
  },
  {
    name: "save_file",
    group: "Files",
    label: "Save file",
    description:
      "Save a file into the business's connected Google Drive or SharePoint, creating the folder path if needed.",
  },
  {
    name: "populate_template",
    group: "Files",
    label: "Populate document template",
    description:
      "Fill a business's .docx template with real data and save the result to their connected storage.",
  },
  {
    name: "invoke_agent",
    group: "Orchestration",
    label: "Invoke agent",
    description:
      "Delegate a task to another agent this one has been explicitly granted access to invoke.",
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
] as const;

export type ToolName = (typeof TOOL_REGISTRY)[number]["name"];

// The order groups appear in the agent form. Declared here rather than
// derived from TOOL_REGISTRY's order so the UI grouping is explicit and
// stable even if a tool is inserted mid-list.
export const TOOL_GROUPS = [
  "Business data",
  "Communication",
  "Calendar",
  "Files",
  "Orchestration",
] as const;

export const TOOL_NAMES = TOOL_REGISTRY.map((t) => t.name) as [
  ToolName,
  ...ToolName[],
];
