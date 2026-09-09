import { env } from "@/lib/env";
import * as microsoftCore from "@/lib/integrations/microsoft/oauth-core";
import type { OAuthAdapter } from "@/lib/integrations/oauth-adapter";

// Sites.ReadWrite.All, not a narrower Sites.Selected — which specific
// SharePoint site an agent archives into isn't known at connect time (the
// same reason Teams asks for a team/channel id after connecting, not
// during OAuth): a business picks the site per workflow once storage
// archiving is wired up. This is deliberately broad and stated plainly in
// Settings (see integrations-section.tsx's ProviderSetupNotes), not hidden.
const SHAREPOINT_SCOPES = [
  "openid",
  "profile",
  "email",
  "offline_access",
  "https://graph.microsoft.com/User.Read",
  "https://graph.microsoft.com/Sites.ReadWrite.All",
];

function requireSharePointRedirectUri(): string {
  if (!env.MICROSOFT_SHAREPOINT_REDIRECT_URI) {
    throw new Error(
      "SharePoint integration is not configured — set MICROSOFT_SHAREPOINT_REDIRECT_URI.",
    );
  }
  return env.MICROSOFT_SHAREPOINT_REDIRECT_URI;
}

export function buildSharePointAuthUrl(state: string): string {
  return microsoftCore.buildMicrosoftAuthUrl(
    state,
    SHAREPOINT_SCOPES,
    requireSharePointRedirectUri(),
  );
}

export function exchangeSharePointCode(
  code: string,
): Promise<microsoftCore.MicrosoftTokens> {
  return microsoftCore.exchangeCodeForTokens(
    code,
    requireSharePointRedirectUri(),
  );
}

export const sharepointOAuthAdapter: OAuthAdapter = {
  provider: "sharepoint",
  buildAuthUrl: buildSharePointAuthUrl,
  async exchangeCode(code) {
    const tokens = await exchangeSharePointCode(code);
    // tokens.email (from the id_token) is preferred over Graph's /me —
    // see decodeIdTokenEmail's comment for why.
    const accountName =
      tokens.email ??
      (await microsoftCore.getMicrosoftProfile(tokens.accessToken)).mail;
    if (!accountName) {
      throw new Error(
        "Could not determine this SharePoint account's email address.",
      );
    }
    return {
      accountName,
      config: { email: accountName },
      credentials: {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
      },
      expiresAt: tokens.expiresAt,
      grantedScopes: tokens.scope ? tokens.scope.split(" ") : [],
    };
  },
};
