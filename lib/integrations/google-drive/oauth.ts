import { env } from "@/lib/env";
import * as googleCore from "@/lib/integrations/google/oauth-core";
import type { OAuthAdapter } from "@/lib/integrations/oauth-adapter";

// Full "drive" scope (not the narrower "drive.file") — a considered choice
// to let Aperator read/write the connected account's entire Drive, not just
// files it creates itself. openid+email identify which account connected,
// the same as every other provider here.
const GOOGLE_DRIVE_SCOPES = [
  "https://www.googleapis.com/auth/drive",
  "openid",
  "email",
];

function requireDriveRedirectUri(): string {
  if (!env.GOOGLE_DRIVE_REDIRECT_URI) {
    throw new Error(
      "Google Drive integration is not configured — set GOOGLE_DRIVE_REDIRECT_URI.",
    );
  }
  return env.GOOGLE_DRIVE_REDIRECT_URI;
}

export function buildGoogleDriveAuthUrl(state: string): string {
  return googleCore.buildGoogleAuthUrl(
    state,
    GOOGLE_DRIVE_SCOPES,
    requireDriveRedirectUri(),
  );
}

export function exchangeGoogleDriveCode(
  code: string,
): Promise<googleCore.GoogleTokens> {
  return googleCore.exchangeCodeForTokens(code, requireDriveRedirectUri());
}

interface GoogleUserInfo {
  email?: string;
}

// drive.file carries no profile scope of its own — openid+email do, via
// Google's standard OIDC userinfo endpoint (the same identity Gmail's
// adapter gets from the Gmail API's own /profile call instead).
async function getGoogleUserEmail(accessToken: string): Promise<string> {
  const response = await fetch(
    "https://www.googleapis.com/oauth2/v3/userinfo",
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `Google userinfo request failed (${response.status}): ${body}`,
    );
  }
  const data = (await response.json()) as GoogleUserInfo;
  if (!data.email) {
    throw new Error("Could not determine this Google account's email address.");
  }
  return data.email;
}

export const googleDriveOAuthAdapter: OAuthAdapter = {
  provider: "google-drive",
  buildAuthUrl: buildGoogleDriveAuthUrl,
  async exchangeCode(code) {
    const tokens = await exchangeGoogleDriveCode(code);
    const email = await getGoogleUserEmail(tokens.accessToken);
    return {
      accountName: email,
      config: { email },
      credentials: {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
      },
      expiresAt: tokens.expiresAt,
    };
  },
};
