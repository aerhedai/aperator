import { env } from "@/lib/env";

// The one place MICROSOFT_CLIENT_ID/SECRET, the authorize/token endpoints,
// and refresh-token-rotation handling live — shared by all three Microsoft
// products (Outlook Mail, Teams, Outlook Calendar), which differ only in
// which scopes they request and which redirect URI they callback to (each
// has its own route path, so each has its own env var — see each product's
// own oauth.ts). One Azure AD app registration backs all three, the same
// way one Google Cloud project backs Gmail.
function requireMicrosoftConfig() {
  if (!env.MICROSOFT_CLIENT_ID || !env.MICROSOFT_CLIENT_SECRET) {
    throw new Error(
      "Microsoft integration is not configured — set MICROSOFT_CLIENT_ID and MICROSOFT_CLIENT_SECRET.",
    );
  }
  return {
    clientId: env.MICROSOFT_CLIENT_ID,
    clientSecret: env.MICROSOFT_CLIENT_SECRET,
  };
}

export interface MicrosoftTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
  // Decoded from the token response's id_token (present whenever "openid"
  // is requested, which every product does) — null only if Microsoft
  // omitted an email/preferred_username claim entirely. This is the
  // primary source for the connected account's identity; see the comment
  // on decodeIdTokenEmail for why it's preferred over a Graph /me call.
  email: string | null;
  // Space-delimited, exactly as Microsoft returns it — the *actually*
  // granted scope, which can be a subset of what was requested. Optional so
  // existing test fixtures that don't care about scope-based tool
  // availability don't need updating; real exchanges always populate it.
  // Not re-captured on refresh, same reasoning as Google's equivalent field.
  scope?: string;
}

export function buildMicrosoftAuthUrl(
  state: string,
  scopes: string[],
  redirectUri: string,
): string {
  const { clientId } = requireMicrosoftConfig();

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    response_mode: "query",
    scope: scopes.join(" "),
    state,
  });

  return `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${params.toString()}`;
}

interface MicrosoftTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  id_token?: string;
  scope?: string;
  error?: string;
  error_description?: string;
}

interface IdTokenClaims {
  email?: string;
  preferred_username?: string;
}

/**
 * The token endpoint's id_token is a real signed JWT (unlike the Graph
 * access_token, which isn't reliably decodable) carrying standard OIDC
 * claims — found live: Graph's /me endpoint can fail with a backend
 * "Store" error for some accounts (a fresh personal Microsoft account, in
 * particular) even though the OAuth exchange itself succeeds cleanly.
 * Reading the identity straight out of the id_token sidesteps that
 * dependency entirely for the one thing this app actually needs from it —
 * which email/account identifies this connection — rather than requiring
 * a separate, occasionally-flaky Graph round trip.
 */
function decodeIdTokenEmail(idToken: string): string | null {
  try {
    const payloadSegment = idToken.split(".")[1];
    if (!payloadSegment) return null;
    const claims = JSON.parse(
      Buffer.from(payloadSegment, "base64url").toString(),
    ) as IdTokenClaims;
    return claims.email ?? claims.preferred_username ?? null;
  } catch {
    return null;
  }
}

async function requestToken(
  body: URLSearchParams,
): Promise<MicrosoftTokenResponse> {
  const response = await fetch(
    "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    },
  );
  const data = (await response.json()) as MicrosoftTokenResponse;

  if (!response.ok) {
    throw new Error(
      `Microsoft token request failed: ${data.error_description ?? data.error ?? response.statusText}`,
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
): Promise<MicrosoftTokens> {
  const { clientId, clientSecret } = requireMicrosoftConfig();

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
      "Microsoft did not return a refresh token — remove Aperator's access at https://myaccount.microsoft.com/ and reconnect so Microsoft issues a fresh one.",
    );
  }

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: new Date(Date.now() + data.expires_in * 1000),
    email: data.id_token ? decodeIdTokenEmail(data.id_token) : null,
    scope: data.scope ?? "",
  };
}

// Fully shared, no per-product variation — unlike Google, Microsoft may
// return a *new* refresh_token here that should replace the stored one;
// refreshToken is only set on the result when that actually happened, so
// callers can tell "no rotation" (undefined) apart from "rotated to X".
export async function refreshAccessToken(
  refreshToken: string,
): Promise<{ accessToken: string; expiresAt: Date; refreshToken?: string }> {
  const { clientId, clientSecret } = requireMicrosoftConfig();

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
    refreshToken: data.refresh_token,
  };
}

export interface MicrosoftProfile {
  mail: string | null;
  userPrincipalName: string;
}

export async function getMicrosoftProfile(
  accessToken: string,
): Promise<MicrosoftProfile> {
  // $select limits which properties Graph resolves — without it, /me
  // resolves the full default property set, which for some accounts
  // (found live: a fresh personal Microsoft account) triggers a mailbox
  // "Store" backend lookup that can be unavailable even when the account
  // itself is otherwise healthy. Restricting to exactly what's needed
  // avoids that extra resolution.
  const params = new URLSearchParams({
    $select: "mail,userPrincipalName",
  });
  const response = await fetch(
    `https://graph.microsoft.com/v1.0/me?${params.toString()}`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `Microsoft Graph profile request failed (${response.status}): ${body}`,
    );
  }
  return response.json();
}
