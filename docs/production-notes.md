# Production Hardening Notes

Deliberate V1 simplifications that are fine for local development but must be
addressed before any real deployment. Each entry names the gap, why it was
accepted for now, and what closing it looks like.

## Catalog collapsed into Record Types (closed)

`Product` and `Customer` were real Postgres tables with real columns, so
every business in every industry carried a retail-shaped schema it could not
change. They are ordinary Record Types now
(`20260904020000_collapse_catalog_into_record_types`), seeded from
`lib/records/starter-record-types.ts` by the template that needs them.

Two things worth knowing about how it was done:

The migration **copies every row into `CustomEntityRecord` before dropping
the tables**, so it is correct whether or not they held data. Both were
verified empty in Production beforehand, but the migration does not depend
on that — a migration whose safety rests on someone having checked a row
count is one that will eventually run against a database nobody checked.

Organisations that existed at the collapse got their field definitions from
the migration's hardcoded JSON; ones created since get them from the code.
`tests/integration/starter-record-types.test.ts` parses the migration file
and compares the two, because nothing else would catch that drift.

**Behaviour change to be aware of:** agents can now write to Product and
Customer, which `BuiltInRecordTypeError` previously refused outright.

## Typed field coercion on the agent write path (closed)

Found while doing the collapse, and it predated it. `create_record` and
`update_record` went straight to the repository, so only the Catalog form
ever ran `buildRecordDataSchema`. A model supplying `"12.5"` for a currency
field stored the **string** `"12.5"` — reads looked correct, and arithmetic
in a later `compute` step silently didn't. Now coerced in
`entity-record-service.ts` for both paths.

Deliberately coerces **types only, not required-ness**, on the agent path.
Every field defined before typed fields existed defaults to `required: true`
without anyone having chosen that, so enforcing it here would start failing
agents already in production that write partial records. The Catalog form
still enforces required on the human path. Tightening the agent path is a
separate decision, not a side effect of this one.

## Gemini as an alternative AI provider (closed)

Added directly because of a real production incident: `rohan-pc` (the only
Ollama host) rebooted, and two real agent runs failed with `fetch failed`
in the ~90-second window before its auto-start scheduled tasks brought
Ollama and its auth proxy back up. Traced with SSH access to the host
itself — `LastBootUpTime`, both scheduled tasks' boot-trigger timestamps,
and the two failed runs' timing all lined up within seconds.

Gemini 2.5 Flash-Lite is now a second connectable provider
(`lib/ai/providers/gemini-provider.ts`), independent of Ollama being up at
all. An organisation can hold both connections at once and switch which is
active in Settings → AI Provider (`Organisation.activeAiProvider`) without
re-entering either's credentials — the actual point, since the realistic
usage is toggling based on whether the home PC happens to be up, not a
one-time migration.

**Known, accepted gap:** switching active provider does not touch existing
agents' `Model` field. An agent still set to `qwen2.5:14b` fails every run
if the org switches to Gemini active without also updating it to
`gemini-2.5-flash-lite`. The Gemini connect form says this explicitly.
Automatic model-name translation was considered and rejected — Ollama and
Gemini's model catalogs don't correspond 1:1, so a translation table would
itself need maintaining as models come and go on both sides, for a
one-time manual edit per agent that isn't expensive to just do.

**Deprecation risk accepted knowingly:** Gemini 2.5 Flash-Lite's
retirement date is Google's own "no earlier than October 16, 2026, not
final" as of when this was built. The model name lives on each agent's
free-string `Model` field, the same mechanism Ollama already used — moving
to `gemini-3.1-flash-lite` when forced is an edit to that field, not a
code change.

**Real gap, not implemented:** `GeminiProvider.generateEmbedding`. The
knowledge base's pgvector column is a fixed `vector(768)` matching
`nomic-embed-text`; Gemini's embedding models default to a different
dimensionality, and silently mismatching that would corrupt retrieval
rather than fail loudly, so it was left out entirely rather than guessed
at.

The consequence is bigger than "no Gemini embeddings" — there is exactly
one _active_ provider per organisation, used for every call including
embeddings, not a per-capability choice. Switching active to Gemini breaks
`search_knowledge` and every `retrieve` step outright (both call
`knowledgeService.search` with its default `"hybrid"` strategy, which
always embeds the query) — it fails loudly with `EmbeddingUnavailableError`,
never silently, but an "Answer from your documented knowledge" agent stops
working the moment Gemini becomes active, not just embeddings generation
in the abstract. Only `strategy: "keyword"` search is unaffected, and
nothing in the product surfaces that as a fallback today. Switch back to
Ollama to restore knowledge search, same as before switching.

## OpenRouter as a third AI provider (closed)

Added for the same reason as Gemini: another provider an organisation can
connect independently, this time to reach hosted models Ollama/Gemini
don't offer (tested live against `upstage/solar-pro4`). Follows the exact
Gemini pattern — `lib/ai/providers/openrouter-provider.ts`,
`Organisation.activeAiProvider` gains a third value, all three can stay
connected at once, `resolveActiveProviderKind()` checks Gemini then
OpenRouter then defaults to Ollama.

Wire format is OpenAI-compatible `chat/completions`, closer to this
codebase's own `AIMessage` shape than Gemini's — the one real gotcha is
that tool call `arguments` travel as a **JSON string** in both directions
(the opposite of Ollama's object-based convention), parsed back with a
fallback to `{}` on malformed JSON rather than crashing a run. No
`generateEmbedding`, same reasoning as Gemini: nothing here forces a
specific embedding dimensionality, but adding one without pinning it to
the existing `vector(768)` column would risk silently corrupting
retrieval rather than failing loudly, so it's left unimplemented instead
of guessed at.

**Known gap, same as Gemini's:** switching active provider doesn't touch
existing agents' `Model` field — an agent still set to an Ollama or
Gemini model name fails every run until manually updated to an
OpenRouter model id.

## Gmail OAuth tokens encrypted at rest (Phase B — closed)

`Integration.accessToken` / `Integration.refreshToken` were stored as plain
text in Postgres through Phase 9. Now encrypted with AES-256-GCM
(`lib/crypto/token-cipher.ts`), wired in at the single chokepoint all reads/
writes already funnelled through (`lib/integrations/integration-repository.ts`)
— nothing above that layer (the service layer, both Gmail route handlers,
`lib/integrations/gmail/{oauth,client}.ts`) had to change or even knows
encryption exists.

The key comes from `TOKEN_ENCRYPTION_KEY`, an env var. This isn't the
"another env var sitting next to the thing it protects" anti-pattern the
old version of this note warned against — that caution is about not storing
the key in the _same datastore_ as the ciphertext (e.g. a second column on
the `Integration` row, or a `Secrets` table in the same Postgres instance),
which this design avoids: the key lives in process env, the ciphertext lives
in Postgres, genuinely separate trust domains for local/CI purposes. It's
still true that a real secrets manager (not a plain env var) is the correct
home for this key before a genuine production deployment — that part of the
original caution doesn't go away, it's just correctly scoped to "before
production," not "before this closes at all."

## Real multi-tenant auth (Phase B)

Every page/action now resolves organisation and user context from a real
Clerk session (`lib/organisations/current-organisation.ts`,
`lib/auth/current-user.ts`) instead of the old "whichever row was created
first" placeholder. Two deliberate simplifications worth knowing about:

- **Provisioning is lazy, not webhook-based.** A brand-new organisation's
  local `Organisation` row and starter Email Handling workflow
  (`provisionEmailWorkflow()`) are created inline, the first time
  `getCurrentOrganisation()` sees a not-yet-seen `clerkOrgId` — not via a
  `/api/webhooks/clerk` endpoint. A webhook route is a new unauthenticated,
  internet-facing endpoint with signature verification to get right, which
  didn't fit a pass whose whole point was shrinking exposure (see the
  disabled `/api/mcp` route below for the same reasoning applied
  elsewhere). Fine at this scale — first-request provisioning does a
  handful of synchronous Prisma upserts, sub-100ms. Would not be fine at
  high-volume signup (thundering herd of first-requests); the fix there is
  additive (move to an async webhook + queue), not a rewrite.
- **No new authorization enforcement.** `User.role` gets populated
  correctly from Clerk's org role (`org:admin`/`org:member` →
  `ADMIN`/`MEMBER`), but nothing is gated by it yet — approve/reject
  (`app/runs/[id]/actions.ts`) still accepts a decision from whichever
  authenticated user submits it, same as before, just now scoped to real
  org members instead of the whole internet. Restricting approve/reject to
  `APPROVER` is real, separable authorization work for later, once role
  data has actually been trustworthy for a while.

## External MCP HTTP endpoint disabled

`app/api/mcp/route.ts` used to expose Aperator's MCP tool server directly
over HTTP with no authentication and no approval-gate enforcement — a real
caller could invoke `send_email` directly, bypassing the approval/audit
system entirely. Found by a security audit; confirmed nothing in the app
called it internally (the real runtime always connects in-process). Now
returns 404. There's a real future use case (an external AI assistant like
Claude Desktop connecting via MCP for read-only lookups —
`find_customer`/`find_product`/`check_inventory`/`calculate_quote`, none of
which have side effects) worth building once it can be scoped to read-only
tools behind real per-organisation authentication, with `send_email`
deliberately kept off whatever gets exposed.

## Phase C: hosting, database, and a real production Ollama path

Deployed at https://aperator.com (Vercel, GitHub-connected — pushes to
`main` auto-deploy; the original `agensync.vercel.app` URL still resolves
too, Vercel kept it as an alias through the project rename) with a Neon
Postgres database provisioned via
Vercel's managed integration (`prisma migrate deploy` applied against
Neon's direct/unpooled connection string; a single connection string is
used for both migrations and runtime for now — Neon's separate pooled
connection string is documented as available but not wired in, since
connection-pool exhaustion isn't a real problem yet at this scale;
revisit if it becomes one, per CLAUDE.md's "don't add infrastructure
before there's a demonstrated need").

**Preview/Development are on a separate Neon branch from Production (closed).**
Vercel's Neon integration originally set `DATABASE_URL` as one value shared
across Production, Preview, _and_ Development — every PR's preview
deployment was reading and writing the exact same database Production
served. Fixed by creating a second Neon branch (`preview-dev`, a
copy-on-write snapshot of `main` at creation time) and pointing Preview and
Development's `DATABASE_URL` at it, leaving Production's own entry
untouched. Zero application code changes — `lib/db/prisma.ts` already only
ever reads `process.env.DATABASE_URL`, so this was purely a Vercel/Neon
configuration change. Two branches now genuinely diverge from this point
forward; a schema migration applied to `main` needs applying to
`preview-dev` too (`prisma migrate deploy` against its own connection
string) to keep it from drifting out of sync, the same as any other real
environment pair.

**`prisma migrate deploy` was never wired into the deploy pipeline (closed,
after a real outage).** `/dashboard` was down in Production for several
hours: every load threw `PrismaClientKnownRequestError` (`P2022`,
`Organisation.termsUrl` does not exist), because the migration that added
that column had merged and deployed as _application code_ while nothing
ever ran `prisma migrate deploy` against the actual Production database —
`db:migrate` (`prisma migrate dev`) only ever runs locally, and the Vercel
build command was plain `next build`. Four migrations had piled up
unapplied on `main` by the time this was caught, and `preview-dev` had the
identical gap (branched from `main` before any of them existed, with
nothing keeping it current per the paragraph above). Fixed in two parts:
applied the missing migrations directly to both the Production and
`preview-dev` databases to restore service, then closed the actual gap by
changing `build` to `prisma migrate deploy && next build` — Vercel runs the
same build command for every environment, so this now keeps Production and
Preview's database schema honest automatically on every deploy, going
forward, without relying on anyone remembering to run it by hand.

**Clerk is on a real Production instance now (closed).** `aperator.com` was
registered (via Cloudflare) as part of the Agensync → Aperator rename, then
wired up end to end: `aperator.com`/`www.aperator.com` pointed at Vercel
(plain A records to `76.76.21.21`, Cloudflare proxy off — Vercel needs to
see the real record to issue its own TLS cert and terminate it itself, and
proxying adds a redundant edge layer that fights that), then
`npx clerk@latest deploy` run interactively to create the production
instance, add the five Clerk-required CNAME records (Frontend API, Accounts
Portal, and three mail/DKIM records) to Cloudflare, and wait for
`clerk deploy status` to report `dns`/`ssl`/`mail` all `complete`. Once
verified, `pk_live_`/`sk_live_` keys were pulled with
`clerk env pull --instance prod` (to a scratch file, not `.env.local` —
Production keys don't work on `localhost`, so local dev keeps using its
`pk_test_`/`sk_test_` keys unchanged) and set on Vercel's Production
environment only, then a redeploy baked them in. The Clerk _application's_
own display name (shown on the hosted sign-in/sign-up cards — "Sign in to
Agensync") was a separate rename, done via the Platform API
(`PATCH /platform/applications/{id}`), since that name isn't part of this
repo's code or config at all.

**Ollama stays the AI provider in production, reached through an
auth-gated proxy, not a hosted commercial API.** Vercel's servers can't
reach the Tailscale-only network the Ollama host lives on directly.
Rather than switch providers, `scripts/ollama-auth-proxy.py` runs
directly on the Ollama host (currently a Windows PC) as a Scheduled Task,
fronted by `tailscale funnel --bg 11435` — turning Ollama into a real
public HTTPS URL. Ollama itself has zero built-in authentication, so the
proxy is what actually protects it: it only forwards a request to Ollama
if it carries the correct `Authorization: Bearer <OLLAMA_PROXY_SECRET>`
header, rejecting everything else with 401 before Ollama ever sees it.
`lib/ai/providers/ollama-provider.ts` sends that header only when
`OLLAMA_PROXY_SECRET` is set — local dev leaves it unset and talks to
Ollama directly, since there's no public exposure to protect against
there.

Deliberate simplifications in this setup, worth knowing about before it
needs to scale or harden further:

- **One shared secret, not per-caller credentials.** Fine for "my own
  Vercel deployment talks to my own Ollama instance" — would need real
  per-caller auth (not a single bearer token) before this proxy fronted
  traffic from more than one trusted caller.
- **The proxy has no rate limiting.** Tailscale Funnel gives TLS and a
  stable public hostname, not traffic shaping. If the shared secret ever
  leaked, nothing would stop it from being used to run unlimited
  inference against the host GPU. Rotating `OLLAMA_PROXY_SECRET` (in both
  Vercel's env vars and the host's `PROXY_SHARED_SECRET` env var, then
  restarting the `AgensyncOllamaProxy` scheduled task) is the immediate
  fix if that's ever suspected.
- **A real bug found by live testing, not by inspection**: the proxy's
  `log_message` override originally still called `super().log_message()`.
  Launched via Task Scheduler, the proxy runs under `pythonw.exe` (no
  console), and `BaseHTTPRequestHandler`'s default logging writes to
  `sys.stderr` after every request — under `pythonw.exe` that's missing
  entirely, not just redirected, and the write crashed the handler thread
  mid-response. The socket-level TCP handshake succeeded every time
  (confirmed directly with `Test-NetConnection`), masking the real cause;
  only an HTTP-level request consistently came back as a connection reset.
  Fixed by making `log_message` a true no-op. Same class of "looks like a
  network/firewall problem, is actually an stdio problem" issue worth
  remembering if this proxy is ever rewritten.
- **This is a stopgap, not the final AI provider story.** The real fix —
  swapping to a hosted commercial API for production while keeping Ollama
  for local dev — is already possible with zero architecture change
  (`AIProvider` was built provider-agnostic from the start) whenever that
  trade-off is worth making. This setup exists specifically to keep using
  Ollama for now without blocking the rest of Phase C on that decision.

**The AI provider is a per-organisation Connection now, not a global env
var (closed, after a real incident).** `AI_PROVIDER`/`OLLAMA_BASE_URL`/
`OLLAMA_PROXY_SECRET` used to be read once at boot and shared by every
organisation on the deployment. With public sign-up live on
`aperator.com`, that meant anyone who created an account — a real
stranger, not a hypothetical — had their agent runs sent straight to the
operator's own Ollama instance, using their own compute and bandwidth,
with no way to tell whose traffic was whose. Fixed by making an AI
provider connection an ordinary `Integration` row
(`lib/ai/organisation-ai-provider.ts`, `provider: "ollama"`) — the same
Connection primitive Gmail/Slack/etc. already use — configured per
organisation from Settings → AI Provider. An organisation with nothing
connected gets a clear `AIProviderNotConfiguredError` (surfaced as a 503
from the webhook route, a plain form error from "Run agent" and
"Check inbox") rather than an implicit fallback to anyone else's machine.
The proxy mechanics above (Tailscale Funnel, the bearer-secret auth) are
unchanged — only _which organisation's_ Ollama a given run reaches is
now explicit and scoped, instead of global.

Resolution is deliberately not fully lazy: `lib/routing/dispatch.ts`
resolves the provider once a workflow/classifier/active-handler is
confirmed to exist, even though the deterministic keyword fast path can
still mean the LLM is never actually called for that particular message
(and a HARNESS pipeline like `entity_status_signal` never calls it at
all). Fully deferring resolution to the exact call that needs it would
mean threading a lazy resolver through every pipeline instead of a
resolved value, for a real but narrow case. `resumeRun`'s `provider` stays
genuinely optional and lazily resolved, since a `REJECTED` decision or a
`HARNESS`-mode approval never reach the one branch (continuing a paused
LOOP conversation) that needs it at all.

**Gmail in production**: the OAuth client's authorized redirect URIs need
`https://aperator.com/api/integrations/gmail/callback` added manually in
Google Cloud Console (Credentials page) — not something the Vercel CLI or
this repo can do on their own. The old
`https://agensync.vercel.app/api/integrations/gmail/callback` entry should
be removed there too once the new one is confirmed working, so a stale
authorized redirect doesn't linger. Vercel's `GOOGLE_REDIRECT_URI` is set
to the new URL for Production only (updated as part of the Agensync →
Aperator rename); Preview deployments get a new
random URL per deployment that's never pre-registered with Google, so
Gmail OAuth is left unconfigured there (attempting to connect on a Preview
deployment will fail — expected, not a bug). The OAuth consent screen
should also be checked: if it's still in "Testing" mode, only explicitly
added test-user Google accounts can complete the OAuth flow at all, which
is fine for a single-operator deployment but would block anyone else's
Gmail from connecting until the app is submitted for verification.

## Token/cost optimization

Measured live against real Ollama (see the agent-runtime commit history):
classify + a full handler-agent completion for one quote email costs
roughly 2,500–3,500 tokens across 3–4 LLM calls, and prompt tokens
dominate (~85% of the total) because the whole conversation — system
prompt, tool schemas, every prior tool result — gets resent on every turn.
That shaped where the actual levers are:

- **Instructions text is resent every turn, but trimming it isn't free —
  it was A/B tested, not just shortened and assumed fine.** A first pass
  cut Quote Agent's opening sentence ("A customer is asking for a price
  quote.") along with genuinely redundant wording. Run head to head on
  the same input: without that opening sentence, 4/4 attempts failed (the
  model wrote its tool call as text instead of a real one); with it
  restored, 4/4 succeeded. The rest of the trim tested fine either way.
  Conclusion: cut redundant _wording_, never the sentence that orients the
  model to the task before the imperatives start — `prisma/seed.ts` keeps
  that sentence on every handler agent now, with a comment explaining why
  it's there.
- **The classifier is a good candidate for a cheaper model than the
  handlers, but not on a single local GPU.** Classification is a
  materially simpler task and, in a hosted deployment, mapping it to a
  cheaper model tier than the handlers is a real, direct saving —
  independent of what the handlers use. Tried this locally first
  (`gemma4:12b` for the classifier vs `qwen2.5:14b` for handlers): a run
  alternates models on every call, and on a single-GPU local Ollama host
  that forces a full unload/reload between them — one classification call
  took 43s instead of ~350ms. That's a local-hosting artifact (hosted
  providers keep every model warm, no swap cost), not a real production
  cost, but it made local dev unusably slow, so `prisma/seed.ts` keeps the
  classifier on the same model as the handlers for now. Revisit this
  specifically when choosing hosted models — it's still the right
  optimization there, just not testable cheaply on this dev setup.
- **Reasoning ("thinking") models are a hidden cost trap for narrow,
  atomic calls specifically.** Tried `qwen3.5:4b` (4.7B, smaller than the
  14B handler model) expecting it to be cheaper/faster for narrow tasks
  like classification — it was 5–10x _slower_. Root cause, confirmed
  directly: it generates a hidden chain-of-thought by default that Ollama
  strips from the visible reply but still counts as real completion
  tokens — a one-sentence reply cost 476 completion tokens and multiple
  seconds. `lib/ai/providers/ollama-provider.ts` now always sends
  `think: false` (harmlessly ignored by models without a thinking mode);
  the same one-sentence reply then cost 10 tokens and ~150ms. On a hosted
  provider this isn't just latency — those hidden tokens get billed, so
  a "cheap" small reasoning model can cost more per call than a bigger
  non-reasoning one for exactly the atomic tasks a neuro-symbolic harness
  is meant to make cheap. Whatever model gets chosen for a hosted
  deployment, check whether it has a reasoning mode and whether it can be
  disabled the same way, before assuming its per-token price is the
  whole cost story.
- **`lib/integrations/gmail/clean-email-body.ts`** strips signature
  blocks and mobile-client footers from the inbound email body before it
  ever reaches a prompt — deliberately conservative (never touches
  quoted/forwarded content, since a customer's real request has been
  observed sitting inside a forwarded block; a wrongly-stripped request is
  a correctness bug, a few extra tokens is not).
- **Prompt caching is not something we can test or measure locally.**
  Ollama doesn't bill per token and has no equivalent caching API, so
  there's no local experiment that would produce a real number here. But
  the system prompt + tool schema for a given agent are already identical
  across every turn of a run and across different runs of the same agent —
  exactly the shape a hosted provider's prompt-caching feature (Anthropic's
  `cache_control` blocks, OpenAI's automatic caching, Gemini context
  caching) is built to exploit, often at a large discount on the cached
  portion. When migrating off Ollama to a hosted provider, enabling that
  provider's caching feature should be part of the same change, not a
  follow-up — the codebase is already structured to make it a no-op on the
  application side.
