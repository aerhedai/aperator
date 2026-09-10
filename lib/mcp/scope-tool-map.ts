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
    "https://mail.google.com/": [
      "GMAIL_SEND_EMAIL",
      "GMAIL_READ_INBOX",
      "GMAIL_SEARCH_INBOX",
      "GMAIL_ARCHIVE_MESSAGE",
      "GMAIL_CREATE_DRAFT",
      "GMAIL_APPLY_LABEL",
    ],
  },
  outlook: {
    "https://graph.microsoft.com/Mail.Read": [
      "OUTLOOK_READ_INBOX",
      "OUTLOOK_SEARCH_INBOX",
    ],
    "https://graph.microsoft.com/Mail.ReadWrite": [
      "OUTLOOK_READ_INBOX",
      "OUTLOOK_SEARCH_INBOX",
      "OUTLOOK_ARCHIVE_MESSAGE",
      "OUTLOOK_CREATE_DRAFT",
    ],
    "https://graph.microsoft.com/Mail.Send": ["OUTLOOK_SEND_EMAIL"],
    "https://graph.microsoft.com/Contacts.ReadWrite": [
      "OUTLOOK_FIND_CONTACT",
      "OUTLOOK_CREATE_CONTACT",
    ],
  },
  "outlook-calendar": {
    "https://graph.microsoft.com/Calendars.Read": [
      "OUTLOOK_CHECK_CALENDAR_AVAILABILITY",
      "OUTLOOK_LIST_CALENDAR_EVENTS",
    ],
    "https://graph.microsoft.com/Calendars.ReadWrite": [
      "OUTLOOK_CHECK_CALENDAR_AVAILABILITY",
      "OUTLOOK_CREATE_CALENDAR_EVENT",
      "OUTLOOK_UPDATE_CALENDAR_EVENT",
      "OUTLOOK_CANCEL_CALENDAR_EVENT",
      "OUTLOOK_LIST_CALENDAR_EVENTS",
    ],
  },
  // Slack's bot scope (chat:write) and user scopes (everything else here)
  // are two independently-grantable halves of the same consent screen —
  // see slack/oauth.ts's SLACK_SCOPES/SLACK_USER_SCOPES and
  // integration-service.ts's getSlackUserToken. A tool needing a user
  // scope is denied by ensureScopeAvailable if that half was declined,
  // even though the bot half (chat:write) was granted.
  slack: {
    "chat:write": ["SLACK_POST_MESSAGE"],
    "search:read.public": ["SLACK_SEARCH_MESSAGES"],
    "search:read.private": ["SLACK_SEARCH_MESSAGES"],
    "search:read.im": ["SLACK_SEARCH_MESSAGES"],
    "search:read.mpim": ["SLACK_SEARCH_MESSAGES"],
    "channels:read": ["SLACK_LIST_CHANNELS"],
    "groups:read": ["SLACK_LIST_CHANNELS"],
    "channels:history": ["SLACK_READ_CHANNEL_HISTORY"],
    "groups:history": ["SLACK_READ_CHANNEL_HISTORY"],
    "users:read": ["SLACK_GET_USER_INFO"],
    "users:read.email": ["SLACK_GET_USER_INFO"],
  },
  teams: {
    "https://graph.microsoft.com/Group.ReadWrite.All": [
      "TEAMS_POST_MESSAGE",
      "TEAMS_LIST_CHANNELS",
      "TEAMS_READ_CHANNEL_MESSAGES",
    ],
  },
  "google-drive": {
    "https://www.googleapis.com/auth/drive": [
      "GOOGLE_DRIVE_CREATE_FOLDER",
      "GOOGLE_DRIVE_SAVE_FILE",
      "GOOGLE_DRIVE_POPULATE_TEMPLATE",
      "GOOGLE_DRIVE_SEARCH_FILES",
      "GOOGLE_DRIVE_LIST_FOLDER",
      "GOOGLE_DRIVE_GET_FILE",
      "GOOGLE_DRIVE_DELETE_FILE",
      "GOOGLE_DRIVE_SHARE_FILE",
    ],
  },
  sharepoint: {
    "https://graph.microsoft.com/Sites.ReadWrite.All": [
      "SHAREPOINT_CREATE_FOLDER",
      "SHAREPOINT_SAVE_FILE",
      "SHAREPOINT_POPULATE_TEMPLATE",
      "SHAREPOINT_SEARCH_FILES",
      "SHAREPOINT_LIST_FOLDER",
      "SHAREPOINT_GET_FILE",
      "SHAREPOINT_DELETE_FILE",
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
