// Which OAuth scope unlocks which provider-specific tool — the data behind
// proactive tool availability (docs/provider-specific-tools-design.md):
// only offer/register a tool when the connected account's *actually
// granted* scope (Integration.config.grantedScopes, captured at connect
// time — see lib/integrations/oauth-adapter.ts) covers it. Requested and
// granted aren't guaranteed to match — a user can decline part of a
// consent screen — so this is checked against what was actually granted,
// not what the app happened to ask for.
//
// One shared map for every provider rather than one file each
// (lib/integrations/<provider>/scope-tool-map.ts) — each provider's own
// mapping is a handful of lines, and splitting them into seven near-empty
// files would cost more to navigate than it would ever save.
//
// Today, every provider requests exactly one broad scope covering all of
// its own tools (Gmail: one full-access scope; Google Drive: one scope;
// Slack's bot scopes are requested together; Teams and SharePoint each
// have one relevant scope) — so in practice most providers currently
// resolve to "all tools or none." Outlook and Outlook Calendar are the
// exception: Mail.Read/Mail.Send and Calendars.Read/Calendars.ReadWrite
// are independently grantable, so this map is where a genuinely partial
// grant actually matters right now. Built as real per-scope data even
// where today's request happens to be monolithic, so narrowing a
// provider's requested scopes later doesn't require touching this file.
export const SCOPE_TOOL_MAP: Record<string, Record<string, string[]>> = {
  gmail: {
    "https://mail.google.com/": ["GMAIL_SEND_EMAIL", "GMAIL_READ_INBOX"],
  },
  outlook: {
    "https://graph.microsoft.com/Mail.Read": ["OUTLOOK_READ_INBOX"],
    "https://graph.microsoft.com/Mail.ReadWrite": ["OUTLOOK_READ_INBOX"],
    "https://graph.microsoft.com/Mail.Send": ["OUTLOOK_SEND_EMAIL"],
  },
  "outlook-calendar": {
    "https://graph.microsoft.com/Calendars.Read": [
      "OUTLOOK_CHECK_CALENDAR_AVAILABILITY",
    ],
    "https://graph.microsoft.com/Calendars.ReadWrite": [
      "OUTLOOK_CHECK_CALENDAR_AVAILABILITY",
      "OUTLOOK_CREATE_CALENDAR_EVENT",
    ],
  },
  slack: {
    "chat:write": ["SLACK_POST_MESSAGE"],
  },
  teams: {
    "https://graph.microsoft.com/Group.ReadWrite.All": ["TEAMS_POST_MESSAGE"],
  },
  "google-drive": {
    "https://www.googleapis.com/auth/drive": [
      "GOOGLE_DRIVE_CREATE_FOLDER",
      "GOOGLE_DRIVE_SAVE_FILE",
      "GOOGLE_DRIVE_POPULATE_TEMPLATE",
    ],
  },
  sharepoint: {
    "https://graph.microsoft.com/Sites.ReadWrite.All": [
      "SHAREPOINT_CREATE_FOLDER",
      "SHAREPOINT_SAVE_FILE",
      "SHAREPOINT_POPULATE_TEMPLATE",
    ],
  },
};

// Case-insensitive on purpose: Microsoft's own docs are inconsistent about
// whether a Graph scope echoes back in the token response as
// "https://graph.microsoft.com/Mail.Read" or
// "https://graph.microsoft.com/mail.read" (verified live — different
// Microsoft Learn pages show both). Rather than gamble on one casing and
// silently lock out every Outlook/Teams/Calendar/SharePoint tool if it
// guessed wrong, both sides are normalized before comparing.
export function getAvailableTools(
  provider: string,
  grantedScopes: string[],
): Set<string> {
  const scopeMap = SCOPE_TOOL_MAP[provider];
  if (!scopeMap) return new Set();

  const granted = new Set(grantedScopes.map((s) => s.toLowerCase()));
  const available = new Set<string>();
  for (const [scope, tools] of Object.entries(scopeMap)) {
    if (granted.has(scope.toLowerCase())) {
      for (const tool of tools) available.add(tool);
    }
  }
  return available;
}
