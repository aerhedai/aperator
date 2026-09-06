# Aperator — Agentic Business Automation Platform

## Product & Engineering Specification — V2 (primitives-first)

---

# 0. How To Read This Document

This is the second major version of this specification. V1 described the
product through a single worked example (an AI Quote Agent) and a
phase-by-phase build plan. That plan is largely complete and the
application is deployed and running.

V1's framing caused a real problem, and correcting it is the main purpose
of this rewrite:

> Describing the product through one example use case caused that example
> to be built as **first-class platform machinery** rather than as one
> configuration among many.

Quoting-specific concepts (`calculate_quote`, `check_inventory`,
`find_product`, a bespoke `quote` pipeline) became permanent primitives.
Every unrelated business now pays rent on them — in the tool list they
must choose from, in the schema, and in the mental model a new developer
has to load.

V2 replaces the example-led framing with a **primitives-led** one. The
platform provides a small, fixed set of generic building blocks. Specific
business processes are expressed as *templates* assembled from those
blocks, never as new platform code.

Everything in sections 8 onward (engineering standards, security,
testing, git workflow) carries over from V1 largely unchanged. Those were
right. It was the product architecture framing that needed correcting.

---

# 1. What Aperator Is

Aperator is a B2B platform that lets a business automate repetitive
processes that currently require an employee to:

1. Receive information
2. Understand and classify it
3. Extract the relevant details
4. Decide what should happen, against business rules
5. Look things up in company systems
6. Perform actions in other systems
7. Communicate the result
8. Escalate anything unusual or sensitive to a human

The central distinction, unchanged from V1 and worth restating:

> This is not primarily an AI chatbot. It is an AI-powered business
> process automation platform.

What makes it defensible is not that an LLM is involved. It is that every
action is **gated by deterministic policy**, **optionally held for human
approval**, and **recorded in a complete audit trail**. The AI proposes;
application code decides.

The underlying promise to a customer:

> Speed up your business using AI agents and pipelined tools — without
> giving up control of what those agents are allowed to do.

---

# 2. Current State

This is a live, deployed application. Do not treat it as greenfield.

```text
Production:   https://aperator.com   (Vercel, auto-deploys from `main`)
Database:     Neon Postgres          (`main` branch = production)
                                     (`preview-dev` branch = preview/dev)
Auth:         Clerk Production instance, multi-tenant via Clerk Orgs
AI:           Per-organisation choice of Ollama (via an auth-gated
                                     Tailscale proxy — still a documented stopgap)
                                     or Gemini (hosted). Ollama remains the
                                     implicit default for every org that
                                     predates this choice.
```

Built and working: organisations/users, agents, workflows (classifier +
handler routing), the agent runtime (LOOP and HARNESS execution modes),
a tool system with per-agent grants, a deterministic policy engine,
human approvals, a full run/step/tool-call audit trail, business-defined
custom entities, and seven OAuth integrations (Gmail, Outlook, Teams,
Slack, Google Drive, SharePoint, Outlook Calendar).

`docs/production-notes.md` is the canonical record of deliberate
simplifications and known production gaps. Read it before changing
anything infrastructural. Keep it current — when a gap closes, say so
there.

---

# 3. Core Architectural Principle — Primitives, Not Verticals

This is the most important section of this document.

> **A vertical is a template. A vertical is never a primitive.**

Platforms that serve many industries all share one property: a small set
of orthogonal nouns, where a CRM and a bug tracker are *the same nouns
configured differently*. Airtable does not ship a `calculate_quote`
feature. Neither should we.

The test to apply before adding anything:

```text
Would a business in a completely unrelated industry
have any use for this concept?

  Yes  → it may be a primitive
  No   → it is a template, built from existing primitives
```

Concretely:

* A landlord, a law firm, a takeaway and a dropshipper must all be
  describable using the same seven nouns in section 4.
* If serving a new customer requires new TypeScript, that is a design
  failure, not a feature. The correct response is to ask which primitive
  is too weak, and strengthen it generically.
* Naming matters. `entity_status_signal` is a good name — it describes a
  shape. `fswd_job_tracker` would have been a bad one.

The failure mode this prevents is real and has already happened here
once. See section 7.

---

# 4. The Seven Primitives

Everything the platform exposes is one of these seven nouns. Nothing else
should become a top-level concept.

```text
   Connection ──── authenticated link to an external system
        │
   Trigger ─────── what causes work to start
        │
   Record Type ─── the shape of the business's own data
        │
   Agent ───────── instructions + granted tools + execution mode
        │
   Tool ────────── a single generic capability
        │
   Policy ──────── deterministic rule gating an action
        │
   Run ─────────── the immutable record of what happened
```

## 4.1 Connection

An authenticated link to an external system, owned by one organisation.

Generic because: the OAuth adapter pattern
(`lib/integrations/oauth-adapter.ts` + `oauth-registry.ts`) means adding a
provider is an adapter file and a registry entry — no route, UI or schema
changes. `Integration.provider` is deliberately a plain string, not a
Postgres enum, so a new provider never needs a migration.

Rules:

* A business may connect multiple accounts of the same provider.
* Credentials are encrypted at rest and never leave the server.
* Least-privilege scopes only. Request the narrowest scope that works.
* The long tail of systems is served by a **generic authenticated HTTP
  connection**, not by bespoke adapters. Do not write a bespoke
  integration for a system a generic HTTP call could reach.

## 4.2 Trigger

What causes work to start.

Currently an enum field on `Workflow` with two values (`EMAIL`,
`WEBHOOK`). This is the least developed primitive and should be promoted
to a first-class configurable entity.

Target trigger types:

```text
EMAIL       inbound mail on a connected mailbox
WEBHOOK     inbound HTTP from an external system
SCHEDULE    time-based — the highest-value missing trigger
FORM        a submitted form / portal entry
FILE        a file arriving in connected storage
MESSAGE     an inbound chat message (Slack/Teams)
MANUAL      a human runs it now, with supplied input
```

`SCHEDULE` is the single highest-leverage addition to the whole product:
it converts Aperator from purely reactive to proactive, and unlocks
recurring reviews, polling systems that have no webhooks, chasing
overdue items, and periodic analysis. Note that inbound email is
currently checked by a **manual dashboard button** — `SCHEDULE` fixes
that too.

## 4.3 Record Type

A business-defined data shape — the business's own domain model.

This is how a landlord gets Properties, a law firm gets Cases and a
dropshipper gets Suppliers and Orders, without a migration per customer.
`CustomEntityType` holds the field definitions; `CustomEntityRecord`
holds rows as JSON keyed by those fields.

Required improvements, in order:

1. **Typed fields.** Every field is currently `z.string()`. Until fields
   can be `number`, `date`, `currency`, `boolean` and `reference`, no
   agent can do arithmetic, sort by time, or link records — which rules
   out most analytical and order-shaped work.
2. **Relations.** A `reference` field type pointing at another Record
   Type. An Order must be able to belong to a Customer.
3. **Aggregation.** A query/aggregate tool (group, sum, average, count,
   bucket by period). Without it the platform can automate work but can
   never answer a question about the business.
4. **Bulk import/export.** CSV in and out. This is the universal escape
   hatch for the many platforms that will never grant API access to a
   small merchant.

`Product` and `Customer` were real tables until the catalog collapse.
They are now ordinary Record Types seeded from
`lib/records/starter-record-types.ts` when a template that needs them is
installed — editable, extendable and deletable like any other. There are
no hardcoded domain tables left. Do not add one.

## 4.4 Agent

An LLM worker: instructions, a set of granted tools, an execution mode,
and a model configuration.

Two execution modes, both first-class:

```text
LOOP     the model decides which tool to call next, turn by turn.
         Flexible, non-deterministic, higher token cost.

HARNESS  a coded pipeline sequences the tools; the model is only asked
         narrow atomic questions (extract these fields, compose this
         reply). Deterministic, cheap, predictable.
```

Prefer HARNESS wherever the process shape is known. LOOP exists for work
that genuinely cannot be sequenced in advance.

Agents compose into a **Workflow**: one CLASSIFIER decides which HANDLER
should deal with an inbound item. A deterministic keyword fast-path
(`lib/routing/deterministic-classify.ts`) skips the LLM entirely when
exactly one handler matches — always prefer deterministic routing when it
is unambiguous.

Rule: agent configuration belongs in `Agent.pipelineConfig` (a JSON bag
each pipeline validates with its own Zod schema), **not** in new named
columns. See section 7 — this rule exists because it was broken.

## 4.5 Tool

A single generic capability an agent may invoke.

The registry (`lib/mcp/tool-registry.ts`) is a small, fixed, reviewable
list. It must not grow with every business-defined concept — this is why
there is one `search_custom_entity` tool taking an entity-type parameter,
rather than one tool per entity type.

Every tool declares: name, description, input schema, output schema,
handler, and permission requirements. The enforcement sequence is
mandatory and lives in application code, never in the model:

```text
LLM requests a tool
        ↓
1. Validate the tool name exists
2. Validate parameters against the input schema
3. Check this agent was granted this tool  (AgentTool)
4. Check organisation permissions
5. Apply policy  (may DENY or REQUIRE_APPROVAL)
6. Execute
7. Record the call
8. Return the result to the model
```

The LLM must never be able to bypass this. A tool absent from an agent's
grants is refused even if the model asks for it — not merely hidden.

Tools should be **verbs against primitives**, not against verticals:

```text
Good:  find_records, create_record, send_message, call_api, search_web
Bad:   calculate_quote, check_inventory, find_product
```

The target tool surface — fewer tools covering strictly more ground than
today's sixteen:

| Capability | Tool |
|---|---|
| Read business data | `find_records`, `search_records` |
| Write business data | `create_record`, `update_record` |
| Analyse business data | `aggregate_records` *(to build)* |
| Communicate | `send_message` (channel: email / slack / teams) |
| Calendar | `check_calendar_availability`, `create_calendar_event` |
| Files | `create_folder`, `save_file`, `populate_template` |
| Reach any system | `call_api` *(to build — generic authenticated HTTP)* |
| Reach the outside world | `search_web` *(to build)* |

`call_api` is the highest-leverage tool not yet built: it serves every
system for which a bespoke integration will never be written.

## 4.6 Policy

A deterministic rule that decides whether a proposed action is allowed.

This is the product's core differentiator and it is currently the least
generic thing in the codebase — `policy-engine.ts` holds a hardcoded
`REQUIRES_APPROVAL_BEFORE_EXECUTION` list. A business cannot express
"quotes over £10,000 need approval" (this document's own long-standing
example) without a developer shipping code.

**Policies must become data.** Target shape:

```text
WHEN   <tool>  is called
AND    <field> <operator> <value>
THEN   ALLOW | REQUIRE_APPROVAL | DENY
```

Rules:

* The policy engine is deterministic application code. The LLM proposes
  an action; policy decides. The model is never the authority on
  permissions.
* Policies are evaluated *before* execution for consequential actions.
* Denials and approval requests are both recorded on the run.

Typed Record Type fields (4.3) are a prerequisite — a rule comparing
against `amount > 10000` needs `amount` to actually be a number.

## 4.7 Run

The immutable record of one execution: `AgentRun` → `RunStep` →
`ToolCall`, plus any `Approval`.

Statuses are explicit, never free strings:

```text
PENDING · RUNNING · WAITING_FOR_APPROVAL · COMPLETED · FAILED · CANCELLED
```

This primitive is in good shape and is a genuine asset. The run detail
page — showing exactly what the agent did, step by step, with token
costs — is one of the most important surfaces in the product. Protect it.

Audit-trail rows must **never** cascade-delete. Configuration rows
(`AgentTool`, `WorkflowAgent`) cascade; runs do not. Deleting an agent
with run history is refused at the FK level and surfaced as "archive
instead".

---

# 5. How The Primitives Compose

One pass through the system:

```text
Connection            (a mailbox, a webhook, a schedule)
     ↓
Trigger fires
     ↓
Workflow selected     (org + trigger + bound account)
     ↓
Classifier agent      (or deterministic keyword match)
     ↓
Handler agent selected
     ↓
Agent runtime starts  →  AgentRun created
     ↓
   ┌──────────────────────────────┐
   │  Agent requests a Tool       │
   │        ↓                     │
   │  Validate name + params      │
   │        ↓                     │
   │  Check grant + org scope     │
   │        ↓                     │
   │  Policy check ───────────────┼──→ DENY  → recorded, refused
   │        ↓                     │
   │  REQUIRE_APPROVAL ───────────┼──→ WAITING_FOR_APPROVAL
   │        ↓                     │         ↓ human decides
   │  Execute Tool                │←────────┘ (approved)
   │        ↓                     │
   │  Record ToolCall + RunStep   │
   │        ↓                     │
   │  Return result to agent      │
   └──────────────┬───────────────┘
                  ↓  (loop, bounded by MAX_AGENT_STEPS)
            Run completes
                  ↓
         Full history visible in UI
```

There must always be safeguards against infinite agent loops. Step limits
are configurable, never unbounded.

---

# 6. Templates

A template is a **saved bundle of primitive configuration** that a
business installs and then edits. It is data, not code.

A template may specify: Record Types and their fields, a Workflow with
its trigger, agents with instructions and tool grants, policies, and
document templates.

```text
"Quote Handling"        Record Types: Product, Customer, Quote
                        Trigger: EMAIL
                        Agents: classifier + quote handler
                        Policy: total > threshold → REQUIRE_APPROVAL

"Order Routing"         Record Types: Order, Supplier, Customer
                        Trigger: WEBHOOK
                        Policy: value > threshold → REQUIRE_APPROVAL

"Job Status Tracking"   Record Types: Job
                        Trigger: WEBHOOK
                        Pipeline: entity_status_signal
```

Rules for templates:

* A template must be expressible entirely in existing primitives. If it
  is not, the gap is in a primitive — fix that generically, do not
  special-case the template.
* Templates are starting points, not constraints. Everything a template
  configures must remain editable afterwards.
* `Workflow.source` already distinguishes `TEMPLATE` from `CUSTOM`, and
  `templateKey` records provenance. Build on those.
* Verticals ship as templates. This is how the product covers many
  industries without the codebase learning about any of them.

---

# 7. Known Architectural Debt

An audit found one repeated pattern: **a specific thing was built, a
generic successor was later built that subsumes it, and the predecessor
was never retired.** Most of that has now been unwound.

## Done

| Legacy (specific) | Now |
|---|---|
| `find_customer`, `find_product`, `check_inventory`, `find_custom_entity_record`, `search_custom_entity` | `find_record` / `search_records`, taking a record type as a parameter |
| `calculate_quote` | Deleted. Arithmetic the quote pipeline does inline — never a capability |
| `check_inventory` | Deleted. Stock is an ordinary field on the Product record |
| `notify_slack`, `notify_teams` | One `notify_channel` with a `platform` parameter |
| `create_/update_custom_entity_record` | `create_record` / `update_record` |
| `create_storage_folder`, `save_storage_file`, `populate_document_template` | `create_folder`, `save_file`, `populate_template` |
| `pipelineConfig.entityType`, `extractionFields[].lookupEntityType` | `recordType` / `lookupRecordType` — one word for one concept |
| `Product`, `Customer` tables | Ordinary Record Types, seeded by the template that needs them. Agents can now write to them; `BuiltInRecordTypeError` is gone |

Sixteen tools became eleven, covering strictly more ground.
`lib/records/record-service.ts` is what made it possible: every type
resolves through one uniform `{id, type, data}` envelope, so the tool
layer never knew which table a record lived in. That abstraction is what
let the `Product`/`Customer` tables be collapsed underneath it later
without the tools changing at all.

`send_email` and `notify_channel` deliberately did **not** merge into a
single "send a message" tool. An outbound customer email and an internal
chat notification are different consequence classes, and the approval gate
depends on telling them apart (§4.6).

## Still open

| Legacy | Generic successor | Blocked on |
|---|---|---|
| `extractionFields`, `guardrailKeywords`, `replySubjectTemplate`, `actionTool` (named `Agent` columns) | `pipelineConfig` (JSON) | Nothing — mechanical, just not done yet |
| `quote` pipeline (bespoke chain) | A template | Templates being real (§6) |

`entity_status_signal` and `entity_correspondence_archive` remain the
model for how a pipeline should be built: neutrally named, config-driven
via `pipelineConfig`, usable by any business.

**Sequencing still matters.** The general rule stands: do not consolidate
before the primitives are strong enough to absorb what is being deleted.
Typed Record Type fields had to land before the catalog collapse, because
`Product.unitPrice` was a `Decimal` and a `currency` field is what
replaced it without downgrading a price to a string.

The collapse migration copies every row into `CustomEntityRecord` before
dropping the tables, so it is correct whether or not they held data —
worth imitating. A migration whose safety depends on someone having
checked a row count first is a migration that will eventually run against
a database nobody checked.

Remaining order:

```text
1. Policies as data   (4.6)
2. SCHEDULE trigger   (4.2)
3. Then the remaining consolidation above
```

A fuller redesign of agent creation (steps as data, replacing the fixed
"Category type" menu) and of the catalog is specified in
`docs/agent-step-engine-design.md` — proposed, not built.

---

# 8. Technology Stack

## Application

* Next.js (App Router), React, TypeScript strict mode
* Tailwind CSS, shadcn/ui

## Data

* PostgreSQL via Prisma ORM
* Zod for all external input validation

## AI

Model providers sit behind `AIProvider` (`lib/ai/`). Ollama, reached in
production through an auth-gated proxy — a documented stopgap, not the
final answer — and Gemini, a hosted commercial API, are both real
implementations now, each an organisation connects independently in
Settings → AI Provider and switches between without losing the other's
credentials. Confirms the abstraction was right: adding Gemini was one new
class plus a translation layer for its wire format
(`lib/ai/providers/gemini-message-mapping.ts`), nothing above `AIProvider`
changed. Never scatter provider-specific SDK calls through the
application — both providers talk to their APIs over plain `fetch`, no
SDK dependency.

## Development

Git, GitHub, Docker Compose, pnpm, ESLint, Prettier, Vitest,
GitHub Actions.

---

# 9. High-Level Architecture

A modular monolith. Do not split into microservices without a
demonstrated need.

```text
                    Next.js Application
                           │
              ┌────────────┴────────────┐
           Frontend                 API Layer
              └────────────┬────────────┘
                           │
                     Service Layer
                           │
             ┌─────────────┼─────────────┐
          Agents       Workflows        Runs
             └─────────────┼─────────────┘
                           │
                      Agent Runtime
                           │
              ┌────────────┼────────────┐
             LLM         Tools       Policies
              └────────────┼────────────┘
                           │
                      PostgreSQL
```

Layering is strict:

```text
UI → API / Server Action → Service → Repository → Prisma → PostgreSQL
```

Repositories own database access. Services own business logic. Route
handlers own HTTP concerns. Never query Prisma from a React component.

---

# 10. Repository Structure

```text
app/          route groups: (app) authenticated, (marketing) public, api/
components/   ui/ plus feature-scoped folders
lib/
  agents/       agent config, schemas, repository, service
  ai/           AIProvider abstraction + implementations
  auth/         current user resolution
  crypto/       token encryption at rest
  db/           Prisma client
  entities/     Record Types and records
  harness/      HARNESS pipelines
  integrations/ one folder per provider + oauth-adapter/registry
  mcp/          tool registry, server, client, tools/
  organisations/
  policies/     policy engine
  routing/      classification and dispatch
  runs/         run persistence and querying
  runtime/      the LOOP agent runtime
  workflows/
prisma/       schema.prisma + migrations
tests/        unit/ and integration/
docs/         production-notes.md and other durable records
```

Maintain clear separation between UI, API, business logic, database
access and infrastructure.

---

# 11. Agent Runtime

The runtime supports: input, agent instructions, available tools, tool
calls, tool results, run state, errors, completion, human approval, and
maximum iteration limits.

When a run pauses for approval, the in-progress conversation is snapshot
to `AgentRun.messages` so `resumeRun()` continues rather than restarting.

Known gap, deliberately unaddressed and documented: **there is no
idempotency guard.** Re-triggering the same underlying event runs the
work again. This is currently safe only because the configured actions
happen to be idempotent (find-or-create semantics). Anything
non-idempotent added later — sending mail, posting a notification,
charging a card — will duplicate. Adding idempotency keys is required
before that point.

---

# 12. Human Approval

The agent does not automatically perform every action.

```text
Agent proposes action
        ↓
Policy: approval required
        ↓
WAITING_FOR_APPROVAL   ← the exact proposed tool arguments are stored,
        ↓                so the approver reviews the real content
Human approves / rejects
        ↓
Run resumes or terminates
```

An approval records: run, requested action, reason, proposed input,
timestamp, status, approver, and decision time.

Gaps worth knowing: nothing currently *notifies* anyone that an approval
is waiting, and `UserRole.APPROVER` exists but is not enforced anywhere.
Both are required before this is trustworthy in a real business.

---

# 13. Validation, Errors, Logging, Security

## Validation

Every API endpoint, server action, webhook payload and tool input is
validated with Zod. Never trust external data.

## Error handling

Distinguish and handle deliberately: validation, authentication,
authorisation, tool, external API, AI, database, workflow, and unknown
errors. No silent failures. No empty catch blocks. Associate failures
with the relevant run.

## Logging

Structured, with `organisationId`, `agentId`, `runId`, `toolCallId` where
applicable. Never log secrets or credentials.

## Security

* Never expose API keys to the browser.
* Never allow cross-organisation data access. Every org-owned query is
  scoped by `organisationId`, and services re-look-up by org rather than
  trusting an id from the caller.
* Authorise every sensitive action.
* Never allow arbitrary code execution through a tool.
* Restrict tools per agent; the LLM cannot bypass application
  permissions.
* Credentials encrypted at rest, server-side only.

---

# 14. UI Principles

Professional, simple, and honest about state.

The most important surface is the **run detail page**: it must make it
immediately obvious what the agent did, in order, with results and cost.

Surface half-configured setups rather than failing silently. An ACTIVE
workflow with no classifier, no active handler, or no connected mailbox
is doing nothing, and the UI must say so
(`lib/workflows/workflow-health.ts`). Extend this pattern to new
primitives — a business owner should never have to guess whether their
setup actually works.

---

# 15. Testing Philosophy

Test behaviour, not just return values. For agentic systems, express
tests as:

```text
Given this input,
the agent should eventually perform these actions
and must never perform these forbidden actions.
```

For example, a £25,000 quote must produce an approval request and must
**not** send an email.

Cover: valid and invalid requests, unknown records, insufficient stock,
invalid tool parameters from the model, tool failures, agent loops,
approval required, approval rejected, external API unavailable, database
failure, and cross-organisation access attempts.

---

# 16. TypeScript Standards

* Strict mode. Explicit types at important boundaries.
* Discriminated unions where they model the domain.
* Zod schemas for anything crossing a runtime boundary, used as the
  single source of truth for both validation and inferred types.
* No `any` without an extremely strong justification.
* Small focused functions, clear interfaces, predictable naming.
* Do not create abstractions to appear sophisticated. Prefer readable
  code.

---

# 17. Claude Code Development Rules

Before significant implementation:

1. Explain the problem.
2. Explain the proposed architecture.
3. Identify files that will change.
4. Explain important TypeScript concepts involved.
5. Identify trade-offs.
6. Implement only once the approach is understood.

After implementation:

1. Explain what changed and why.
2. Explain important code paths.
3. List changed files.
4. Run lint, typecheck, tests, and build where appropriate.
5. **Report failures honestly.** Never describe unverified work as
   verified.

Always explain architectural decisions. The purpose is not only to
generate code, but to build a professional system the developer fully
understands.

---

# 18. Claude Code Must Not

* Build a vertical feature as a primitive. Check section 3 first.
* Add a hardcoded domain table, tool, or pipeline for one customer.
* Add a named `Agent` column for one pipeline's setting — use
  `pipelineConfig`.
* Write a bespoke integration where a generic HTTP call would serve.
* Create unnecessary files or abstractions.
* Add dependencies without explaining why.
* Use `any` to silence TypeScript, or disable ESLint rules to make errors
  disappear.
* Ignore failing tests, hide errors, or claim unverified success.
* Hard-code secrets or commit them.
* Introduce Kubernetes, Kafka, Redis, Temporal, or a vector database
  without a demonstrated need.
* Build a drag-and-drop workflow editor. It is enormous and premature.

---

# 19. Git Workflow

Meaningful, scoped commits. No enormous commits mixing unrelated changes.

```text
feat: add scheduled trigger type
fix: prevent duplicate tool execution
test: add quote agent runtime tests
docs: record production database isolation
```

---

# 20. CI

GitHub Actions runs: install → lint → format check → typecheck →
migrations → tests → build. A pull request is not complete if these fail.

`build` runs `prisma migrate deploy && next build`, so every deploy keeps
the target database's schema current. This exists because its absence
caused a real production outage — see `docs/production-notes.md`.

---

# 21. Environment Variables

`.env.local` for local development, `.env.example` as the checked-in
template. Never commit real secrets.

```text
DATABASE_URL=
AI_PROVIDER=
OLLAMA_BASE_URL=
CLERK_SECRET_KEY=
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=
TOKEN_ENCRYPTION_KEY=
GOOGLE_CLIENT_ID= / GOOGLE_CLIENT_SECRET= / ...
MICROSOFT_CLIENT_ID= / MICROSOFT_CLIENT_SECRET= / ...
SLACK_CLIENT_ID= / SLACK_CLIENT_SECRET= / ...
```

Production keys live only in the hosting provider's environment. Local
development continues to use test keys — Clerk production keys do not
work on `localhost`.

---

# 22. Roadmap

Ordered by how much each unlocks, not by how visible it is.

## Tier 1 — removes a ceiling on genericness

1. **Typed + relational Record Type fields**, plus an `aggregate_records`
   tool. Unblocks arithmetic, dates, relations, and any analytical
   question.
2. **Policies as data.** Makes the core differentiator self-serve.
3. **`SCHEDULE` trigger.** Reactive → proactive. Also removes the manual
   inbox-check button.
4. **User-composable pipelines.** Removes the need for a developer per
   new process shape.

## Tier 2 — makes it trustworthy enough to sell

5. Approval notifications, and approving from email/Slack.
6. Role enforcement (`APPROVER` is currently decorative).
7. Idempotency keys on runs.
8. Retries, failure alerting, and a dead-letter path.
9. Dry-run / simulation mode — test an agent with no side effects.
10. SLA timers and escalation.

## Tier 3 — breadth

11. `call_api` — generic authenticated HTTP.
12. `search_web`.
13. Knowledge base / retrieval over the business's own documents.
14. CSV import/export.
15. Spreadsheet read/write.
16. Further triggers: form, file drop, inbound message, manual.
17. Further channels: SMS/WhatsApp.
18. Commerce and finance connections: Stripe, Shopify, Xero, HubSpot.
19. Cross-run memory.
20. Agent version history and rollback.

## Tier 4 — commercial

Usage metering, billing, and surfacing outcome metrics (see section 23).
The audit trail already holds the raw data for these; nothing surfaces
them yet.

---

# 23. Commercial Direction

The proposition:

> We identify repetitive business processes and turn them into AI-powered
> workflows that understand information, make decisions, interact with
> business systems, and complete tasks — under rules you control.

Report business outcomes, not AI usage:

```text
Requests processed        1,248
Automatically completed   1,031
Human approvals             183
Failed                       34
Estimated hours saved       412
```

---

# 24. Engineering Principle

> **Build the simplest system that proves the next piece of the product,
> while maintaining professional engineering standards.**

Complexity is not quality. The architecture must be able to grow into a
serious B2B platform, but must stay small enough that the developer
understands every major part of it.

And, specific to this product:

> **When a customer needs something new, the right question is which
> primitive is too weak — not which special case to add.**

---

# 25. Workflow Automation and Branching Policy

Enforced mechanically via `.claude/settings.json` hooks and GitHub branch
protection, so they cannot be silently skipped.

## Prompt transcript

Every user prompt is appended to `transcript/prompts.md` by a
`UserPromptSubmit` hook (`.claude/hooks/log-prompt.sh`). This is
unconditional — it logs every prompt, including ones a user asks not to be
logged in the moment; if a prompt must be excluded, remove it from
`transcript/prompts.md` afterward. `transcript/` is gitignored — it's a
local working log, not part of the repository.

## Frontend screenshots before a PR

Editing any file under `app/`, `components/`, or any `.tsx`/`.css` file
sets a local marker (`.claude/.frontend-dirty`, gitignored) via a
`PostToolUse` hook (`.claude/hooks/mark-frontend-dirty.sh`). A
`PreToolUse` hook (`.claude/hooks/check-pr-screenshot.sh`) blocks
`gh pr create` while that marker is set. To proceed: take a screenshot of
the running app, attach it to the PR body, then run
`rm .claude/.frontend-dirty`.

This gate can only enforce an explicit acknowledgment step — it cannot
verify a screenshot was actually taken or is accurate. Treat it as a
forcing function against forgetting, not a substitute for actually
looking at the page.

## Branching model

```text
main   — protected, always deployable, auto-deploys to production
  ↑ PR only
dev    — protected, integration branch
  ↑ PR only
feature/* — branched off dev, one per issue/feature
```

* No direct pushes to `main` or `dev`. All changes land via a pull
  request.
* Feature branches are cut from `dev`, not `main`.
* `main` only receives merges from `dev` (releases), never directly from
  a feature branch.
* Enforced server-side via GitHub branch protection on `main` and `dev`
  (required PR, required `ci` status check, no direct pushes, no force
  pushes, enforced for admins too). A `PreToolUse` hook
  (`.claude/hooks/block-protected-push.sh`) also blocks direct
  `git push` to `main`/`dev` locally, as a fast failure ahead of the
  server-side rejection.
