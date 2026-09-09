import { env } from "@/lib/env";
import { getGmailProfile } from "@/lib/integrations/gmail/client";
import * as googleCore from "@/lib/integrations/google/oauth-core";
import type { OAuthAdapter } from "@/lib/integrations/oauth-adapter";

// The full-account scope: read, compose, send, and permanently delete mail
// (Google's own consent-screen wording for this exact scope). Deliberately
// broader than gmail.modify+gmail.send (which can trash but never
// permanently delete) — a considered choice, not the least-privilege
// default, so it's called out here rather than left to look accidental.
const GMAIL_SCOPES = ["https://mail.google.com/"];

// Deliberately still GOOGLE_REDIRECT_URI (not GOOGLE_GMAIL_REDIRECT_URI) —
// this is Gmail's pre-existing, already-deployed env var; renaming it would
// break the real connected Gmail account in production for no functional
// benefit. Google Drive gets its own GOOGLE_DRIVE_REDIRECT_URI instead,
// same shared-client/per-product-redirect shape Microsoft's products use.
function requireGmailRedirectUri(): string {
  if (!env.GOOGLE_REDIRECT_URI) {
    throw new Error(
      "Gmail integration is not configured — set GOOGLE_REDIRECT_URI.",
    );
  }
  return env.GOOGLE_REDIRECT_URI;
}

// Gmail's stored token shape is exactly Google's generic one — kept as its
// own name here since lib/integrations/integration-service.ts's Gmail-only
// code path reads more clearly as "GmailTokens" than "GoogleTokens".
export type GmailTokens = googleCore.GoogleTokens;

export function buildGmailAuthUrl(state: string): string {
  return googleCore.buildGoogleAuthUrl(
    state,
    GMAIL_SCOPES,
    requireGmailRedirectUri(),
  );
}

export function exchangeGmailCode(
  code: string,
): Promise<googleCore.GoogleTokens> {
  return googleCore.exchangeCodeForTokens(code, requireGmailRedirectUri());
}

export const refreshAccessToken = googleCore.refreshAccessToken;

// The generic connect/callback routes (app/api/integrations/[provider]/)
// drive Gmail through this shared interface instead of Gmail-specific route
// code — the extra getGmailProfile call to resolve the connected email
// address happens here, inside the adapter, so the generic callback route
// never needs to branch on provider.
export const gmailOAuthAdapter: OAuthAdapter = {
  provider: "gmail",
  buildAuthUrl: buildGmailAuthUrl,
  async exchangeCode(code) {
    const tokens = await exchangeGmailCode(code);
    const profile = await getGmailProfile(tokens.accessToken);
    return {
      accountName: profile.emailAddress,
      config: { email: profile.emailAddress },
      credentials: {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
      },
      expiresAt: tokens.expiresAt,
    };
  },
};
