# External MCP server connections — design

## Context

Aperator's tool surface is entirely hand-coded today: every capability an
agent can use is a TypeScript file in `lib/mcp/tools/`, registered in two
more hand-maintained places (`lib/mcp/tool-registry.ts`'s fixed list,
`lib/mcp/server.ts`'s manual `register()` calls). Connecting a new external
system (via `lib/integrations/<provider>/`'s OAuth adapter pattern) makes a
`Connection` exist, but gives an agent nothing to do with it — someone still
has to write a tool file, add a registry entry, and register it, every time.

The user wants to wire up a long list of external services (Gmail, Slack,
Notion, HubSpot, Linear, Stripe, and ~60 more) and, rather than hand-writing
a tool file per capability per provider, wants "connect it" to be the whole
job wherever the target system can expose its own tools. Two matching
capabilities make this possible without inventing new machinery:

- Many SaaS products now ship (or will ship) their own remote **MCP
  server** — a system that already speaks the same protocol Aperator's
  runtime already speaks to its own tools (`@modelcontextprotocol/sdk`,
  used in-process today via `InMemoryTransport`).
- The Model Context Protocol's `tools/list` response already carries
  everything a generic proxy needs: name, description, JSON Schema input,
  and an optional `readOnlyHint` annotation.

This spec covers **one new capability: connecting to an external MCP
server, discovering its tools, and making them grantable to agents with no
code written per tool.** It does **not** cover migrating any of the 7
existing OAuth-based integrations (Gmail, Outlook, Slack, Teams, Calendar,
Drive, SharePoint) off their current hand-written tool files — whether any
of those vendors' own MCP servers are worth pointing at instead is a
real, separate question that needs verifying per-vendor, not assumed here,
and is explicitly out of scope for this piece of work.

## Decisions this design makes, and why

**A connection to an external MCP server is an ordinary `Integration` row,
not a new primitive or table.** `Integration.provider` is already a plain
string precisely so a new provider never needs a migration (CLAUDE.md
§4.1). `provider: "mcp"`, `config: {url, label}` (plaintext), `credentials:
{token}` (encrypted at rest, same as every other integration). The list of
tools that connection currently exposes is cached in `config` too —
refreshed at connect time and via a manual "Refresh tools" action, not
re-fetched over the network on every agent run. A network round trip to
every connected external server on every single run would add real latency
and a new failure mode (an unrelated agent's run breaking because someone
else's MCP server is briefly down).

**Tools are proxied at the server layer, not fanned out in the runtime.**
When `createMcpServer(organisationId, ...)` builds an org's tool server —
as it already does for every run — it also loads that org's `mcp`-type
Integrations and, from each one's cached tool list, registers one
forwarding tool per discovered tool on Aperator's _own_ in-process
`McpServer`. Each forwarding tool's handler does nothing but open a real
MCP client to the remote server (`StreamableHTTPClientTransport`, real
network transport — the first non-in-memory MCP client this codebase
has) and call it through. `lib/runtime/agent-runtime.ts` and
`lib/runtime/tool-execution.ts` — the code that actually enforces grants
and policy — see no change at all: it is still exactly one MCP client
talking to exactly one server. This was chosen over the alternative (the
runtime juggling multiple real MCP clients directly, one per connection)
specifically because that alternative would mean grant-checking and
policy-checking happening at _N_ client boundaries instead of one — more
surface area for the exact kind of bypass CLAUDE.md §4.5's single
enforcement chokepoint exists to prevent.

**Proxied tools get a permissive pass-through input schema, not a faithful
JSON-Schema→Zod translation.** Our own tools declare Zod schemas; a remote
server's tools declare JSON Schema. Attempting a faithful conversion is
fragile — any schema library chosen will eventually hit a shape it can't
express — and unnecessary: the remote server is the authoritative
validator for its own tool. Aperator's schema validation exists to protect
_our_ application boundary, which a pass-through schema still does (the
call still can't reach the remote server at all unless the name and
top-level shape are plausible); the remote server validates the rest.

**Tool names split into two validated shapes, not one.** `AgentTool.toolName`
is currently a compile-time literal union (`TOOL_NAMES`, derived from the
fixed `TOOL_REGISTRY` array) — every valid name known at build time, same
for every organisation. Discovered tools break that assumption by
definition: org A's Notion connection and org B's Linear connection expose
different, org-specific names nothing in code has ever seen. Going
forward, a granted tool name is either (a) one of the fixed, reviewed
`TOOL_REGISTRY` names — unchanged, still Zod-validated against a compile-time
union — or (b) a namespaced discovered name, `mcp:<integrationId>:<remoteToolName>`,
validated at grant-save time by checking it against that Integration's
_currently cached_ tool list rather than a compile-time enum. An agent can
only ever be granted a tool that genuinely exists on a connection its own
organisation actually has.

**Newly-discovered tools default to approval-gated unless declared
read-only.** `policy-engine.ts`'s `requiresApprovalBeforeExecution` is
today a hardcoded array of Aperator's own tool names, each one a case a
human already reviewed. A tool discovered from someone else's server has
had no such review. MCP's `readOnlyHint` tool annotation is the one signal
available to judge this without reading the remote implementation: `true`
→ runs freely like any other read-only tool; anything else, including a
server that declares no hint at all (which the spec permits) → held for
human approval before it runs, the same `WAITING_FOR_APPROVAL` path
`send_email` already goes through today. This is additive — the existing
hardcoded list for Aperator's own tools is untouched.

**v1 auth is a static bearer token/API key, not full OAuth.** Covers most
hosted MCP servers available today. A server requiring the emerging MCP
authorization spec's dynamic client registration isn't reachable yet — a
real, narrow, and explicitly documented gap, not a silent one.

## Data model

No new table. `Integration` gains one more valid `provider` value:

```
provider: "mcp"
config: {
  label: string          // shown in the UI ("Notion", "My internal MCP server")
  url: string             // the MCP server's endpoint
  tools: [{               // cached from the last successful listTools() call
    name: string
    description: string
    inputSchema: unknown  // raw JSON Schema, stored as-is
    readOnlyHint: boolean | null
  }]
  toolsRefreshedAt: string // ISO timestamp
}
credentials: { token: string }   // encrypted at rest, same as every Integration
expiresAt: null                  // static tokens don't expire on a schedule
```

No changes to `AgentTool`'s columns — `toolName` stays a plain string; what
changes is what's allowed to validate against it (see "Grant model"
below).

## Connecting one (UI flow)

Settings → Integrations gains one more entry alongside the existing OAuth
"Connect" buttons: "Connect a custom MCP server" — a small form (label,
URL, bearer token). On submit, the server opens a real MCP client against
that URL and calls `listTools()` as a live connectivity + auth check
before ever saving anything — a broken URL or bad token fails at connect
time with a clear, specific error, not silently at first agent run. The
returned tool list (including each tool's `readOnlyHint`) is what gets
cached in `Integration.config.tools`. A "Refresh tools" action on the
connected integration's row re-runs the same `listTools()` call and
replaces the cache — the mechanism a business uses after the remote server
adds a new tool.

## Discovery + proxy mechanism (runtime)

New module, `lib/integrations/mcp/external-client.ts`:

- `connectExternalMcpClient(url, token)` — real MCP SDK `Client`, real
  `StreamableHTTPClientTransport` (not `InMemoryTransport` — the first
  genuinely networked MCP client this codebase has), bearer token attached
  per request.
- Used both at connect time (the live `listTools()` check above) and by
  each proxied tool's handler at call time.

`lib/mcp/server.ts`'s `createMcpServer` gains one more step, after
registering the fixed tools it registers today: load the organisation's
`mcp`-provider Integrations, and for each one, for each cached tool in
`config.tools`, `register()` a forwarding tool named
`mcp:<integrationId>:<remoteToolName>` — the namespace exists only so the
name is unique inside _our_ server's tool list; the handler calls
`connectExternalMcpClient` and calls the remote server using
`remoteToolName` alone (the name it actually knows), returning whatever it
responds with. If a specific connection can't be reached while
building this list (the remote server is down), that one connection's
tools are skipped for this run — logged, not fatal — every other tool
(built-in or from a different connection) is unaffected.

## Grant model

The agent editor's tool checklist (`components/agents/agent-form.tsx`'s
Tools & Permissions section) gains one more group per connected `mcp`
Integration, populated from `Integration.config.tools` — dynamic, not from
`TOOL_REGISTRY` — sitting alongside the existing fixed groups. Ticking one
writes `mcp:<integrationId>:<remoteToolName>` as an `AgentTool.toolName`,
exactly the same write path as any other tool grant today.

Validation at save time (replacing the current single `TOOL_NAMES` Zod
enum check): a submitted tool name is valid if it's in `TOOL_NAMES`, _or_
it matches the `mcp:<integrationId>:<remoteToolName>` shape _and_ that
exact `(integrationId, remoteToolName)` pair is currently present in that
integration's cached tool list for this organisation. An agent can never be
granted a tool from a connection that isn't this organisation's own.

## Policy

`lib/policies/policy-engine.ts`'s `requiresApprovalBeforeExecution` gains a
branch: for a name matching `mcp:<integrationId>:<remoteToolName>`, look up
that tool's cached `readOnlyHint`. `true` → not gated (same as
`readOnlyHint`-marked built-in tools like `find_record` today); anything
else → gated, same `WAITING_FOR_APPROVAL` path as `send_email`. Untouched:
the existing hardcoded list governing Aperator's own tools.

## Error handling

- Connect-time: `listTools()` failure (unreachable URL, bad token, invalid
  MCP response) → the Integration row is never created; the form shows the
  specific failure.
- Build-time (`createMcpServer`): one connection's `listTools()`/proxy
  registration failing skips only that connection's tools for this run —
  never fatal to the whole tool set.
- Call-time: a proxied tool call failing (network error, remote server
  error, remote-side validation rejecting the pass-through input) is
  recorded as a normal `FAILED` `ToolCall` — identical bookkeeping to any
  other tool failure today, nothing proxy-specific for the rest of the
  runtime to know about.

## Testing

- `external-client.ts`: a real MCP server stood up in-test (the SDK
  supports this the same way the existing in-process tests do, just over a
  real HTTP transport instead of `InMemoryTransport`) — connect, list
  tools, call a tool, and the failure cases (unreachable, bad token,
  malformed response).
- `createMcpServer`: with a real external MCP server fixture, proxied
  tools appear in `listTools()` correctly namespaced; a call round-trips
  correctly; one connection being unreachable doesn't affect a different
  connection's tools or the fixed built-in tools.
- Grant validation: a discovered tool name validates only when it's
  actually in that org's cached list; a name copied from a _different_
  org's connection is rejected.
- Policy: a `readOnlyHint: true` discovered tool call executes directly; a
  `readOnlyHint: false`/absent one pauses for approval, creates a real
  `Approval` row, and — this is the test that matters most, mirroring how
  `invoke_agent`'s own tests were built — never actually executes before
  that approval is granted.
- End-to-end, live-verified in browser: connect a real external MCP
  server, grant one of its tools to an agent, run it, confirm the proxied
  call actually reaches the remote server and its result reaches the
  agent's reply.

## Critical files

- `lib/integrations/mcp/external-client.ts` (new)
- `lib/mcp/server.ts`
- `lib/agents/agent-tool-repository.ts` / wherever `AgentTool.toolName`
  validation currently lives
- `lib/policies/policy-engine.ts`
- `components/agents/agent-form.tsx` (Tools & Permissions section)
- `app/(shell)/(app)/settings/integrations/` (new "Connect a custom MCP
  server" form + "Refresh tools" action)
- `lib/integrations/integration-service.ts` / `integration-repository.ts`

## Explicitly out of scope for this piece

- Migrating any of the 7 existing OAuth-based integrations off their
  hand-written tool files. Whether Gmail, Outlook, Slack, Teams, or any of
  the others actually have an official MCP server worth pointing at
  instead of the current hand-written client is unverified and vendor by
  vendor — separate follow-up work once this mechanism exists and each
  vendor's situation is actually checked.
- Full OAuth 2.1 / dynamic client registration support for external MCP
  servers that require it (only static bearer token/API key auth is
  supported).
- The generic `call_api` tool (API-only connections with no MCP server at
  all) — a related but separate roadmap item, not built here.
