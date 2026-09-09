import { env } from "@/lib/env";
import * as microsoftCore from "@/lib/integrations/microsoft/oauth-core";
import type { OAuthAdapter } from "@/lib/integrations/oauth-adapter";

// Group.ReadWrite.All (not the narrower ChannelMessage.Send) — a deliberate
// widening, not a default: Teams are backed by Microsoft 365 Groups, so this
// grants create/read/manage over every group in the tenant, not just
// posting to a channel the app is already in. Tenant admins commonly gate
// this permission, so some users won't be able to self-consent to it.
const TEAMS_SCOPES = [
  "openid",
  "profile",
  "email",
  "offline_access",
  "https://graph.microsoft.com/User.Read",
  "https://graph.microsoft.com/Group.ReadWrite.All",
];

function requireTeamsRedirectUri(): string {
  if (!env.MICROSOFT_TEAMS_REDIRECT_URI) {
    throw new Error(
      "Teams integration is not configured — set MICROSOFT_TEAMS_REDIRECT_URI.",
    );
  }
  return env.MICROSOFT_TEAMS_REDIRECT_URI;
}

export function buildTeamsAuthUrl(state: string): string {
  return microsoftCore.buildMicrosoftAuthUrl(
    state,
    TEAMS_SCOPES,
    requireTeamsRedirectUri(),
  );
}

export function exchangeTeamsCode(
  code: string,
): Promise<microsoftCore.MicrosoftTokens> {
  return microsoftCore.exchangeCodeForTokens(code, requireTeamsRedirectUri());
}

/**
 * Teams messages sent through this connection appear as sent by whichever
 * person authorized it (delegated ChannelMessage.Send has no plain-OAuth
 * "post as a bot" equivalent to Slack's bot token — a real "Aperator"
 * identity needs Azure Bot Service, a separate, materially bigger piece of
 * infrastructure, deliberately not built here). This is stated in the
 * Settings UI copy for this provider, not just here.
 */
export const teamsOAuthAdapter: OAuthAdapter = {
  provider: "teams",
  buildAuthUrl: buildTeamsAuthUrl,
  async exchangeCode(code) {
    const tokens = await exchangeTeamsCode(code);
    // tokens.email (from the id_token) is preferred over Graph's /me —
    // see decodeIdTokenEmail's comment for why.
    const accountName =
      tokens.email ??
      (await microsoftCore.getMicrosoftProfile(tokens.accessToken)).mail;
    if (!accountName) {
      throw new Error(
        "Could not determine this Teams account's email address.",
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
