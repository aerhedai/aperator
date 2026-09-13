// Deterministic, application-code policy checks — the LLM recommends an
// action, this decides whether it's actually permitted (CLAUDE.md §4.6).

import { parseApiToolName } from "@/lib/integrations/api/tool-naming";
import * as integrationService from "@/lib/integrations/integration-service";
import { parseMcpToolName } from "@/lib/integrations/mcp/tool-naming";

export type PolicyDecision = "ALLOW" | "DENY" | "REQUIRE_APPROVAL";

export interface PolicyResult {
  decision: PolicyDecision;
  reason: string;
}

export interface PolicyContext {
  toolName: string;
  toolOutput: Record<string, unknown>;
}

// Tools that mutate external, customer-visible (or otherwise consequential
// and hard-to-undo) state must never run without a human approving the
// exact proposed content first — no amount threshold, no exceptions.
// Checked before the tool executes (see agent-runtime.ts) — approving
// after the fact can't un-send an email or un-invite a meeting.
//
// SLACK_POST_MESSAGE/TEAMS_POST_MESSAGE are deliberately NOT here: an
// internal Slack/Teams message to the business's own workspace is a
// different consequence class from a customer-visible email or a real
// calendar invite. That distinction is exactly why the chat-notification
// tools and the email tools stayed separate rather than merging into one
// "send a message" (CLAUDE.md §4.5).
//
// Enumerated per provider-specific tool (GMAIL_SEND_EMAIL,
// OUTLOOK_SEND_EMAIL, OUTLOOK_CREATE_CALENDAR_EVENT) rather than per
// abstract capability, since each provider's action is now its own tool —
// see docs/provider-specific-tools-design.md.
//
// This hardcoded set is the known limitation on the whole policy
// primitive: a business cannot express its own rules (e.g. "quotes over
// £10,000 need approval") without a developer editing this file. Making
// policies data is Tier 1 roadmap work — CLAUDE.md §4.6.
const REQUIRES_APPROVAL_BEFORE_EXECUTION = new Set([
  "GMAIL_SEND_EMAIL",
  "OUTLOOK_SEND_EMAIL",
  "OUTLOOK_CREATE_CALENDAR_EVENT",
  // Same "notifies attendees, hard to undo" reasoning as
  // OUTLOOK_CREATE_CALENDAR_EVENT above.
  "OUTLOOK_UPDATE_CALENDAR_EVENT",
  "OUTLOOK_CANCEL_CALENDAR_EVENT",
  // Removing or granting access to a file a business expects to find (or
  // control who can see) is consequential enough to warrant a human
  // confirming first, even though both are reversible in principle
  // (Drive's trash, revoking a permission) — CLAUDE.md §4.6's "no amount
  // threshold, no exceptions."
  "GOOGLE_DRIVE_DELETE_FILE",
  "GOOGLE_DRIVE_SHARE_FILE",
  "SHAREPOINT_DELETE_FILE",
]);

export async function requiresApprovalBeforeExecution(
  toolName: string,
  organisationId: string,
  args?: Record<string, unknown>,
): Promise<boolean> {
  if (REQUIRES_APPROVAL_BEFORE_EXECUTION.has(toolName)) return true;

  // call_api can reach any path on its pinned connection with any method —
  // unlike every other tool here, its consequence depends entirely on
  // *this* call's own arguments, not just its name. GET/HEAD is a read
  // with no side effect; anything else is a mutation on a system Aperator
  // has no way to know the blast radius of, so it requires a human every
  // time, with no per-connection exception yet (that needs policies as
  // data, CLAUDE.md §4.6, same gap as everywhere else this hardcoded list
  // can't express a business's own rule).
  if (parseApiToolName(toolName)) {
    const method = typeof args?.method === "string" ? args.method : null;
    return method !== "GET" && method !== "HEAD";
  }

  const parsed = parseMcpToolName(toolName);
  if (!parsed) return false;

  const tool = await integrationService.findMcpTool(
    organisationId,
    parsed.integrationId,
    parsed.remoteToolName,
  );
  // Not found (disconnected, stale grant, cache mismatch) or not
  // explicitly marked read-only — fail closed, require approval. A
  // readOnlyHint is an unverified claim from the remote server itself
  // (the MCP spec's own docs warn clients not to make trust decisions
  // based on it) — trusting it here only ever *relaxes* an additional
  // safety net (human approval), never grants access that wasn't already
  // explicitly given via an AgentTool row.
  return tool?.readOnlyHint !== true;
}

// Post-execution policy: evaluated on a tool's result, for tools with no
// external side effect (safe to run first, then decide whether the run may
// continue). No active rules currently — kept as the extension point
// CLAUDE.md #14 calls for, for whenever a future tool needs one.
export function evaluatePolicy(_context: PolicyContext): PolicyResult {
  return { decision: "ALLOW", reason: "No policy restricts this action." };
}
