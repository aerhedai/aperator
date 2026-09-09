# Provider-specific integration tools — design

## Context

Today, seven OAuth-connected providers (Gmail, Outlook, Slack, Teams,
Outlook Calendar, Google Drive, SharePoint) share a small number of
cross-provider tool files. `send_email` branches internally on whether the
resolved account is Gmail or Outlook; `notify_channel` branches on Slack vs.
Teams; `create_folder`/`save_file`/`populate_template` branch on Google
Drive vs. SharePoint. `lib/mcp/server.ts`'s `createMcpServer` resolves which
branch applies by looking up the calling agent's pinned
`actionIntegrationId`, deriving its provider, and threading that account id
into whichever shared tool(s) match (`pinnedFor("gmail", "outlook")`,
`emailId`, `slackId`, `teamsId`, `calendarId`).

This was a deliberate consolidation at the time (CLAUDE.md §7 records
`notify_slack`/`notify_teams` → `notify_channel` as completed, intentional
work) — the reasoning was "don't hand-write two near-identical tool files."
That reasoning stops applying once the goal shifts to giving each provider
its own clean, unbranched implementation: there's no longer a shared file to
avoid duplicating, because there was never going to be a shared file in the
first place.

Earlier drafts of this design considered discovering tools automatically
from each provider's own MCP server where one exists (verified live this
round: Slack's official server is GA and covers sending; Gmail's is
Developer Preview and currently has no send tool; Outlook/Teams have no
official server at all, only unofficial community ones). That direction is
explicitly **not** what this spec builds — every provider gets hand-written
code, always, no per-provider MCP-maturity check. What _does_ carry over
from that exploration is the naming shape: each provider's capability gets
its own distinctly-named tool, the same way a real MCP server would expose
`GMAIL_SEND_EMAIL` as its own tool rather than one server exposing a
generic `send_email` that secretly talks to whichever backend is configured.

This spec is unrelated to, and does not change, the existing generic
"connect any external MCP server" feature
(`docs/superpowers/specs/2026-09-07-external-mcp-connections-design.md`).
That feature is about a _business_ plugging in a system Aperator has no
special knowledge of. This spec is about how Aperator implements its own
seven first-party providers.

## Decisions this design makes, and why

**One tool per provider per capability. No shared, branching tool.**
`send_email` splits into `GMAIL_SEND_EMAIL` and `OUTLOOK_SEND_EMAIL`, each
its own file, each talking to exactly one provider's API, with no
conditional branching on provider inside a handler ever again. This is a
direct, mechanical application of "tools should be verbs against
primitives, not verticals" (CLAUDE.md §4.5) at the integration layer:
`GMAIL_SEND_EMAIL` names a capability against one identified system, not an
abstraction that has to guess which system it's really talking to. It also
deletes real code: `lib/mcp/server.ts`'s `pinnedFor`/`emailId`/`slackId`/
`teamsId`/`calendarId` resolution exists only because one shared tool might
serve either of two providers — once a tool can only ever mean one
provider, there's nothing left to resolve.

**Provider-specific tool names are visually distinct from primitive tool
names.** `TOOL_REGISTRY` today is entirely `lower_snake_case`
(`find_record`, `create_record`, `search_records`). Provider-specific
action tools use `UPPER_SNAKE_CASE`
(`GMAIL_SEND_EMAIL`, `SLACK_POST_MESSAGE`) — an immediate, greppable signal
in the registry, in an agent's tool grants, and in a run's tool-call log
about which category a tool belongs to: a generic business-data primitive
versus a call against one specific connected system. This is cosmetic but
deliberate — CLAUDE.md's own tool table already separates "primitives" from
provider-shaped actions conceptually; the naming convention makes that
split visible everywhere the name appears, not just in a design doc.

**Full before/after tool inventory:**

| Today (shared, branching)     | Becomes                                                          |
| ----------------------------- | ---------------------------------------------------------------- |
| `send_email`                  | `GMAIL_SEND_EMAIL`, `OUTLOOK_SEND_EMAIL`                         |
| `read_inbox`                  | `GMAIL_READ_INBOX`, `OUTLOOK_READ_INBOX`                         |
| `notify_channel`              | `SLACK_POST_MESSAGE`, `TEAMS_POST_MESSAGE`                       |
| `check_calendar_availability` | `OUTLOOK_CHECK_CALENDAR_AVAILABILITY`                            |
| `create_calendar_event`       | `OUTLOOK_CREATE_CALENDAR_EVENT`                                  |
| `create_folder`               | `GOOGLE_DRIVE_CREATE_FOLDER`, `SHAREPOINT_CREATE_FOLDER`         |
| `save_file`                   | `GOOGLE_DRIVE_SAVE_FILE`, `SHAREPOINT_SAVE_FILE`                 |
| `populate_template`           | `GOOGLE_DRIVE_POPULATE_TEMPLATE`, `SHAREPOINT_POPULATE_TEMPLATE` |

`check_calendar_availability`/`create_calendar_event` only have one real
provider today (Outlook Calendar), but get the provider prefix anyway for
consistency with every other row and so a future second calendar provider
doesn't require renaming the first one out from under existing grants.

**Per-agent static account binding is unchanged** — still one
`Agent.actionIntegrationId` pinning an agent to one specific connected
account, same as today. The only real change is that ambiguity disappears:
a `GMAIL_SEND_EMAIL` grant can only ever mean a Gmail account, so there's
no more "which provider does this shared tool's pinned account belong to"
resolution step at all.

**Separate agents per provider, not adaptive per-agent tool lists.** An
"email agent" that needs to work against both Gmail and Outlook is two
agents, not one agent whose available tools silently reshape based on
whichever account happens to be bound. This was chosen over building
adaptive tool-visibility because it costs almost nothing today — agents
already pin to one account — while adaptive settings would require
re-validating existing grants whenever a bound account changes, deciding
what happens to a provider-specific grant when its provider is
disconnected, and instructions that read as provider-agnostic ("check the
inbox") silently meaning different things per provider underneath. The
real cost of separate agents (duplicating near-identical instructions
across two agent rows) is deliberately left unsolved by this spec — a
"duplicate this agent" convenience action is a cheap, separate follow-up if
that pain turns out to matter in practice, far cheaper than building
adaptivity up front for a problem not yet confirmed to exist.

**A new validation: an agent's granted tools must match its bound
account's provider.** `lib/agents/agent-service.ts`'s
`validateActionIntegration` already checks that `actionIntegrationId`
points at a provider in `ACTION_ACCOUNT_PROVIDERS`. It gains a second
check: every granted `AgentTool` whose name matches a known
provider-specific tool must belong to the same provider as the agent's
bound account. Granting `GMAIL_SEND_EMAIL` to an agent pinned to an Outlook
account is rejected at save time, not discovered at run time.

**Tool availability is scope-aware, not just connection-aware.** Today, a
provider-specific tool being grantable only requires the provider to be
connected at all. This design adds a second gate: whether the specific
bound account's _actually-granted_ OAuth scope covers that tool.
"Actually-granted" matters because a user can partially decline scopes on
a consent screen — requested and granted are not guaranteed to match, and
none of the three OAuth exchange functions (`exchangeGmailCode`,
`exchangeSlackCode`, the shared Microsoft `exchangeCodeForTokens`) capture
the `scope` field every one of those providers already returns alongside
the token. This is a real, currently-unused piece of data, not something
new to request.

Concretely: `OAuthExchangeResult` (`lib/integrations/oauth-adapter.ts`)
gains `grantedScopes: string[]`, populated from each provider's token
response and stored in `Integration.config` (plaintext — granted scopes
aren't secret). A small, explicit, per-provider map (e.g.
`lib/integrations/gmail/scope-tool-map.ts`) declares which granted scope
unlocks which tool name — `"https://mail.google.com/"` → `["GMAIL_SEND_EMAIL",
"GMAIL_READ_INBOX"]`. This map is used in two places: the agent editor's
tool checklist only offers a provider-specific tool for grant if the
bound account's `grantedScopes` covers it, and `createMcpServer` only
`register()`s a provider-specific tool for a given run if the same check
passes — so even a stale grant (scopes changed after the grant was saved)
can't produce a live, callable tool it shouldn't.

**Scope-based filtering is the primary gate; translating a live
insufficient-scope error into "Tool access denied" is the mandatory
backstop, not a replacement.** Scopes can be revoked outside Aperator
entirely (a user changes app permissions on the provider's own account
page), and the scope→tool map can have gaps or bugs. This mirrors exactly
how `policy-engine.ts` already treats an external MCP tool's
`readOnlyHint` — an advisory signal that shapes the UX, never the sole
enforcement point. Every provider-specific tool handler's actual API call
gets wrapped so a 401/403/insufficient-scope-shaped response from the
provider is caught and re-recorded as a clean, consistent error — "Tool
access denied — the connected account no longer grants this permission" —
rather than the provider's raw error text reaching the run.

**Policy becomes account-aware.** `PolicyContext`
(`lib/policies/policy-engine.ts`) gains `integrationId?: string` — which
connected account, if any, a tool call is bound to — threaded through from
wherever a tool call is dispatched. This is deliberately narrow: it does
not build the full "policies as data" authoring surface CLAUDE.md's
roadmap already lists as separate, larger, Tier-1 work. What it does is
make `DENY` a genuinely reachable decision (today it's a modeled
`PolicyDecision` value the engine never actually returns) and give a future
data-driven rule something to condition on beyond tool name alone — e.g.
"this specific Gmail account may never call `GMAIL_SEND_EMAIL`" as a rule,
not a scope problem. `REQUIRES_APPROVAL_BEFORE_EXECUTION`'s hardcoded set
is mechanically migrated from `{"send_email", "create_calendar_event"}` to
every corresponding provider-specific name
(`GMAIL_SEND_EMAIL`, `OUTLOOK_SEND_EMAIL`, `OUTLOOK_CREATE_CALENDAR_EVENT`)
— same rule, same reasoning ("can't un-send an email"), just enumerated
per concrete tool instead of per abstract capability.

This is a separate, orthogonal concern from scope-based availability, not
a duplicate of it: scope-based filtering answers "can this account
technically do this at all," policy answers "should this specific action
ever happen without a human approving it" — a call can pass the first gate
and still be stopped by the second.

## Data model

No new tables. Changes to existing shapes:

```
OAuthExchangeResult (lib/integrations/oauth-adapter.ts)
  + grantedScopes: string[]   // from the token response's own `scope` field

Integration.config (JSON, unchanged shape otherwise)
  + grantedScopes: string[]   // copied from the exchange result at connect time
```

`AgentTool.toolName` stays a plain string column — no schema change. What
changes is the compile-time union it validates against (`TOOL_NAMES` grows
to include every provider-specific name) and, new, a save-time check that
cross-references the agent's bound account's `grantedScopes` via the
per-provider scope→tool map.

## Registration mechanism (runtime)

`lib/mcp/server.ts`'s `createMcpServer` currently registers every fixed
tool unconditionally, then loops over `mcp`-provider Integrations for
proxied tools. It gains one more category in between: for the calling
agent's bound account (if any), resolve its provider and its
`grantedScopes`, and `register()` only the provider-specific tools that
provider's scope map says are covered — skipping ones the account can't
actually do rather than registering them and letting a call fail. If no
account is bound (org-default fallback, same as today), the same
resolution runs against whichever account `getDefaultIntegrationByProvider`
would pick.

Each provider-specific tool's handler follows the same shape as today's
provider-branching tools, minus the branch: resolve a valid access token
for the one provider it's written for (`getValidGmailAccessToken`,
`getSlackBotToken`, etc. — these functions are unchanged), make the one API
call it exists to make, and on a scope-shaped failure, return the
translated "Tool access denied" error rather than the provider's raw one.

## Migration for existing data

This is a live, deployed application (CLAUDE.md §2) — existing
organisations already have real `AgentTool` rows granting `send_email`,
`notify_channel`, etc. A migration script, run once:

1. For every `AgentTool` row whose `toolName` is one of the eight shared
   names being retired, resolve that row's agent's `actionIntegrationId`
   (or, if null, the organisation's default-connected account for that
   tool's capability — same fallback `getDefaultEmailIntegration`-style
   logic already uses today).
2. Rewrite the row's `toolName` to the corresponding provider-specific name
   for that resolved account's provider.
3. Any row that can't resolve a provider (the bound/default account was
   since disconnected) is flagged in the migration's output for manual
   review rather than silently dropped or guessed at — an agent losing a
   grant silently is worse than a migration that takes a manual look at a
   handful of rows.

Only once this migration has run cleanly against production do the eight
old shared tool names get removed from `TOOL_REGISTRY` and their files
deleted.

## Testing

- One unit test file per new provider-specific tool, covering: the happy
  path, "account not connected" (tool absent/error, mirroring today's
  coverage for the shared tools it replaces), and the translated
  "Tool access denied" path for a simulated insufficient-scope response.
- `agent-service.ts`: the new cross-check (granted tool's provider must
  match bound account's provider) — both the accepting and rejecting case.
- `createMcpServer`: an account with partial `grantedScopes` (e.g. Gmail
  connected with `gmail.readonly` only) results in `GMAIL_READ_INBOX`
  being registered and `GMAIL_SEND_EMAIL` being absent from that run's tool
  list entirely — not present-but-erroring.
- Policy: a rule keyed on `integrationId` correctly reaches `DENY` for a
  matching call and `ALLOW`/no-match for a different account calling the
  same tool name.
- Migration: run against a fixture database with grants across all eight
  old names, several bound accounts, and one row whose account was
  disconnected — confirm the flagged-for-review case is actually flagged,
  not silently mishandled.

## Critical files

- `lib/mcp/tools/` — eight new files replacing eight existing ones (see
  inventory table above)
- `lib/mcp/server.ts` — registration loop gains scope-aware filtering;
  `pinnedFor`/`emailId`/`slackId`/`teamsId`/`calendarId` deleted
- `lib/mcp/tool-registry.ts` — `TOOL_NAMES`/`TOOL_REGISTRY` grow, eight old
  entries removed once migration is confirmed
- `lib/integrations/oauth-adapter.ts` — `OAuthExchangeResult` gains
  `grantedScopes`
- `lib/integrations/{gmail,outlook,slack,teams,outlook-calendar,google-drive,sharepoint}/oauth.ts`
  — each captures its provider's returned `scope` field
- New: one `scope-tool-map.ts` per provider
- `lib/policies/policy-engine.ts` — `PolicyContext` gains `integrationId`;
  `REQUIRES_APPROVAL_BEFORE_EXECUTION` migrated to provider-specific names
- `lib/agents/agent-service.ts` — `validateActionIntegration` gains the
  provider-match cross-check
- `components/agents/agent-form.tsx` — Tools & Permissions section computes
  available provider-specific tools from the bound account's
  `grantedScopes`, not a static list
- One-off migration script (location per this repo's existing migration
  conventions)

## Explicitly out of scope

- The full "policies as data" authoring UI/schema CLAUDE.md's roadmap
  already lists separately (§4.6, §22 Tier 1) — this spec only makes
  `PolicyContext` account-aware and `DENY` reachable, laying groundwork for
  that work rather than building it.
- Any per-provider MCP-server integration for Aperator's own seven
  providers — explicitly rejected as this design's direction (see
  Context). The existing generic external-MCP-connection feature for
  businesses connecting their own systems is unrelated and untouched.
- A "duplicate this agent" convenience feature to ease the cost of
  separate-agents-per-provider — a real, cheap follow-up, not built here.
- Full OAuth-scope-to-tool coverage beyond the capabilities already built
  (send/read email, post a message, calendar availability/create, file
  archive) — a provider scope that unlocks a capability with no
  corresponding tool yet has nothing to map to until that tool exists.
