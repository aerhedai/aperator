// The reactive backstop for scope-based tool availability
// (docs/provider-specific-tools-design.md): proactive filtering
// (lib/mcp/scope-tool-map.ts) keeps a tool from being offered or
// registered when the connected account's granted scope doesn't cover it,
// but scope can also be revoked *outside* Aperator entirely — a user
// changes app permissions on Google's or Microsoft's own account page —
// and the scope-tool map can simply have a gap or bug. This is the same
// "advisory signal, never the sole enforcement" reasoning
// policy-engine.ts already applies to MCP's readOnlyHint: never trust one
// check alone for something this consequential.
//
// Detection is a pattern match on the client functions' own error message
// shape, not a structured error type — every REST client in
// lib/integrations/*/client.ts throws `... failed (${response.status}): ...`,
// and 403 specifically (not 401, which the token-refresh logic already
// handles as an expired/invalid token) is Google's and Microsoft Graph's
// shared convention for "this token is valid but lacks the scope for this
// operation." Slack never uses HTTP status for this (its API returns 200
// even on failure) — it reports the same condition as the literal error
// code "missing_scope" in its JSON body, which lib/integrations/slack/client.ts
// already surfaces as part of its own thrown message.
//
// Not foolproof — a 403 can rarely mean something else — but this is the
// same kind of advisory signal already accepted elsewhere in this
// codebase, not a new, weaker standard.
const INSUFFICIENT_SCOPE_PATTERNS = [/\(403\)/, /missing_scope/i];

export function translateScopeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const looksLikeInsufficientScope = INSUFFICIENT_SCOPE_PATTERNS.some(
    (pattern) => pattern.test(message),
  );
  if (looksLikeInsufficientScope) {
    return "Tool access denied — the connected account no longer grants this permission. Reconnect it from Settings if this capability is still needed.";
  }
  return message;
}
