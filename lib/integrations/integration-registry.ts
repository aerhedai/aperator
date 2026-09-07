// The single canonical list of valid integration providers — same
// reasoning as lib/mcp/tool-registry.ts: Integration.provider is a plain
// string column, not a Postgres enum (a migration per new provider isn't
// worth it), so this is what actually constrains which values are real.
//
// connectionMode drives which "Add account" UI the Settings page renders
// (components/settings/integrations-section.tsx) — "oauth" is the default
// for every provider that supports it (click Connect, log into the tool
// you already use, no copy-pasting anything — the easiest flow for a
// non-technical business owner). "manual" is the fallback for providers
// with no OAuth option (webhook accounts don't have an "account" to
// authorize against; the business is generating a credential for us to
// call, not the other way round).
export const INTEGRATION_REGISTRY = [
  {
    provider: "gmail",
    label: "Gmail",
    description:
      "Connect a Gmail address to trigger agents from labelled inbound email, and to send replies.",
    connectionMode: "oauth",
  },
  {
    provider: "slack",
    label: "Slack",
    description:
      "Connect a Slack workspace so agents can post internal notifications to a channel.",
    connectionMode: "oauth",
  },
  {
    provider: "outlook",
    label: "Outlook",
    description:
      "Connect an Outlook/Microsoft 365 account to trigger agents from folder-routed inbound email, and to send replies — the Outlook alternative to Gmail.",
    connectionMode: "oauth",
  },
  {
    provider: "teams",
    label: "Teams",
    description:
      "Connect a Microsoft Teams account so agents can post internal notifications to a channel.",
    connectionMode: "oauth",
  },
  {
    provider: "outlook-calendar",
    label: "Outlook Calendar",
    description:
      "Connect an Outlook Calendar so agents can check availability and book meetings.",
    connectionMode: "oauth",
  },
  {
    provider: "webhook",
    label: "Webhook",
    description:
      "Get a unique URL and secret that anything able to send a JSON POST (a form backend, Zapier, another internal system) can use to trigger a workflow.",
    connectionMode: "manual",
  },
  {
    provider: "google-drive",
    label: "Google Drive",
    description:
      "Connect a Google Drive so agents can archive inbound email and attachments into a folder structure.",
    connectionMode: "oauth",
  },
  {
    provider: "sharepoint",
    label: "SharePoint",
    description:
      "Connect a SharePoint site so agents can archive inbound email and attachments into a folder structure — the SharePoint alternative to Google Drive.",
    connectionMode: "oauth",
  },
  {
    provider: "mcp",
    label: "Custom MCP server",
    description:
      "Connect any external system's own MCP server by URL and bearer token — every tool it exposes becomes grantable to your agents, no code required.",
    connectionMode: "manual",
  },
] as const;

export type IntegrationProviderName =
  (typeof INTEGRATION_REGISTRY)[number]["provider"];
