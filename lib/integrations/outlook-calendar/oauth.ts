import { env } from "@/lib/env";
import * as microsoftCore from "@/lib/integrations/microsoft/oauth-core";
import type { OAuthAdapter } from "@/lib/integrations/oauth-adapter";

const CALENDAR_SCOPES = [
  "openid",
  "profile",
  "email",
  "offline_access",
  "https://graph.microsoft.com/User.Read",
  "https://graph.microsoft.com/Calendars.ReadWrite",
];

function requireCalendarRedirectUri(): string {
  if (!env.MICROSOFT_CALENDAR_REDIRECT_URI) {
    throw new Error(
      "Outlook Calendar integration is not configured — set MICROSOFT_CALENDAR_REDIRECT_URI.",
    );
  }
  return env.MICROSOFT_CALENDAR_REDIRECT_URI;
}

export function buildOutlookCalendarAuthUrl(state: string): string {
  return microsoftCore.buildMicrosoftAuthUrl(
    state,
    CALENDAR_SCOPES,
    requireCalendarRedirectUri(),
  );
}

export function exchangeOutlookCalendarCode(
  code: string,
): Promise<microsoftCore.MicrosoftTokens> {
  return microsoftCore.exchangeCodeForTokens(
    code,
    requireCalendarRedirectUri(),
  );
}

export const outlookCalendarOAuthAdapter: OAuthAdapter = {
  provider: "outlook-calendar",
  buildAuthUrl: buildOutlookCalendarAuthUrl,
  async exchangeCode(code) {
    const tokens = await exchangeOutlookCalendarCode(code);
    // tokens.email (from the id_token) is preferred over Graph's /me —
    // see decodeIdTokenEmail's comment for why.
    const accountName =
      tokens.email ??
      (await microsoftCore.getMicrosoftProfile(tokens.accessToken)).mail;
    if (!accountName) {
      throw new Error(
        "Could not determine this Outlook Calendar account's email address.",
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
