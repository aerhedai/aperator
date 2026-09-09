import { env } from "@/lib/env";

// The one place GOOGLE_CLIENT_ID/SECRET, the authorize/token endpoints, and
// refresh handling live — shared by every Google product (Gmail, Google
// Drive), which differ only in which scopes they request and which
// redirect URI they callback to (each has its own route path, so each
// needs its own env var — see each product's own oauth.ts). One Google
// Cloud project backs all of them, the same way one Azure AD app
// registration backs every Microsoft product.
function requireGoogleConfig() {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    throw new Error(
      "Google integration is not configured — set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.",
    );
  }
  return {
    clientId: env.GOOGLE_CLIENT_ID,
    clientSecret: env.GOOGLE_CLIENT_SECRET,
  };
}

export interface GoogleTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
  // Space-delimited, exactly as Google returns it — the *actually* granted
  // scope, which can be a subset of what was requested if the user declines
  // part of the consent screen. Optional so existing test fixtures that
  // don't care about scope-based tool availability don't need updating;
  // real exchanges always populate it. Not re-captured on refresh: Google's
  // refresh_token grant doesn't narrow scope on its own (a revoked scope
  // invalidates the refresh token entirely rather than silently shrinking
  // it), so the connect-time value stays authoritative for this token's life.
  scope?: string;
}

export function buildGoogleAuthUrl(
  state: string,
  scopes: string[],
  redirectUri: string,
): string {
  const { clientId } = requireGoogleConfig();

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: scopes.join(" "),
    access_type: "offline",
    prompt: "consent",
    state,
  });

  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

interface GoogleTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope?: string;
  error?: string;
  error_description?: string;
}

async function requestToken(
  body: URLSearchParams,
): Promise<GoogleTokenResponse> {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const data = (await response.json()) as GoogleTokenResponse;

  if (!response.ok) {
    throw new Error(
      `Google token request failed: ${data.error_description ?? data.error ?? response.statusText}`,
    );
  }
  return data;
}

// redirectUri is required here (unlike refreshAccessToken below) because
// the authorization_code grant must echo back the exact redirect_uri the
// code was issued for — the refresh_token grant has no such requirement.
export async function exchangeCodeForTokens(
  code: string,
  redirectUri: string,
): Promise<GoogleTokens> {
  const { clientId, clientSecret } = requireGoogleConfig();

  const data = await requestToken(
    new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  );

  if (!data.refresh_token) {
    throw new Error(
      "Google did not return a refresh token — revoke Aperator's access at https://myaccount.google.com/permissions and reconnect so Google issues a fresh one.",
    );
  }

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: new Date(Date.now() + data.expires_in * 1000),
    scope: data.scope ?? "",
  };
}

export async function refreshAccessToken(
  refreshToken: string,
): Promise<{ accessToken: string; expiresAt: Date }> {
  const { clientId, clientSecret } = requireGoogleConfig();

  const data = await requestToken(
    new URLSearchParams({
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
    }),
  );

  return {
    accessToken: data.access_token,
    expiresAt: new Date(Date.now() + data.expires_in * 1000),
  };
}
