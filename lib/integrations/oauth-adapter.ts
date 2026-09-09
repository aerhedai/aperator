// The shared shape every OAuth-connected provider implements — the part of
// the connect/callback flow that really is identical across providers
// (build an authorize URL, exchange a code for credentials). What each
// provider's tokens look like, how long they last, and how to identify the
// connected account are all genuinely provider-specific, so those stay data
// returned from exchangeCode rather than forced into a shared shape.
//
// Deliberately no refresh method here — only Gmail currently needs
// refresh-before-expiry (lib/integrations/integration-service.ts's
// getValidGmailAccessToken); Slack bot tokens don't expire in the standard
// (non-token-rotation) flow. Generalizing a refresh cycle from a sample of
// one real case would be guessing at a shape before a second case exists to
// confirm it — add it if/when a second provider actually needs refresh too.
export interface OAuthExchangeResult {
  // Becomes Integration.name — the human-readable account label (a Gmail
  // address, a Slack workspace name).
  accountName: string;
  // Integration.config — plaintext, non-secret identifying info.
  config: Record<string, unknown>;
  // Integration.credentials — encrypted at rest by upsertIntegration.
  credentials: Record<string, unknown>;
  // Integration.expiresAt — null for tokens that don't expire.
  expiresAt: Date | null;
  // The scope(s) the provider actually granted — can be a subset of what
  // was requested if the user declined part of the consent screen. Folded
  // into Integration.config by connectOAuthAccount (plaintext — granted
  // scope isn't secret) rather than stored as its own column, same
  // reasoning as every other provider-specific identifying field. Optional
  // so existing test fixtures that predate this field don't need updating;
  // every real adapter populates it. connectOAuthAccount defaults an
  // absent value to [] before storing.
  grantedScopes?: string[];
}

export interface OAuthAdapter {
  provider: string;
  // True for providers that require PKCE (RFC 7636) — Slack does, for any
  // redirect_uri that isn't a real HTTPS URL (localhost during local dev
  // counts as "non-web"). The generic connect/callback routes generate and
  // persist a code_verifier/code_challenge pair only when this is set, so
  // providers that don't need it (Gmail) see no behavior change at all.
  usesPkce?: boolean;
  buildAuthUrl(state: string, codeChallenge?: string): string;
  exchangeCode(
    code: string,
    codeVerifier?: string,
  ): Promise<OAuthExchangeResult>;
}
