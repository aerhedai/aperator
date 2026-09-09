import { env } from "@/lib/env";
import type { OAuthAdapter } from "@/lib/integrations/oauth-adapter";

// chat:write.public lets the bot post to any public channel without first
// being manually invited to it — chat:write alone would require a business
// to /invite the bot into every channel an agent might notify, exactly the
// kind of extra technical step this integration is trying to avoid for a
// non-technical business owner.
const SLACK_SCOPES = "chat:write,chat:write.public";

// A deliberate widening requested on top of the bot scopes above — these are
// Slack *user* token scopes (Slack's OAuth v2 issues a separate
// authed_user.access_token for these, distinct from the bot token SLACK_SCOPES
// produces). Requested here so the consent screen shows them; exchangeSlackCode
// below does not yet capture or persist authed_user.access_token, so none of
// this is usable by any tool yet — that's a separate, not-yet-built piece of
// work, not an oversight.
const SLACK_USER_SCOPES = [
  "reminders:read",
  "users.profile:read",
  "identity.basic",
  "channels:history",
  "channels:read",
  "groups:history",
  "groups:read",
  "im:history",
  "im:read",
  "links:read",
  "mpim:history",
  "mpim:read",
  "pins:read",
  "reactions:read",
  "search:read.files",
  "search:read.im",
  "search:read.mpim",
  "search:read.private",
  "search:read.public",
  "calls:read",
  "dnd:read",
  "emoji:read",
  "files:read",
  "remote_files:read",
  "team:read",
  "usergroups:read",
  "users:read",
  "users:read.email",
  "chat:write",
  "dnd:write",
  "groups:write",
  "im:write",
  "mpim:write",
  "pins:write",
  "reactions:write",
  "remote_files:share",
  "users.profile:write",
  "users:write",
  "files:write",
  "links:write",
  "calls:write",
  "reminders:write",
  "usergroups:write",
].join(",");

function requireSlackConfig() {
  if (
    !env.SLACK_CLIENT_ID ||
    !env.SLACK_CLIENT_SECRET ||
    !env.SLACK_REDIRECT_URI
  ) {
    throw new Error(
      "Slack integration is not configured — set SLACK_CLIENT_ID, SLACK_CLIENT_SECRET and SLACK_REDIRECT_URI.",
    );
  }
  return {
    clientId: env.SLACK_CLIENT_ID,
    clientSecret: env.SLACK_CLIENT_SECRET,
    redirectUri: env.SLACK_REDIRECT_URI,
  };
}

export function buildSlackAuthUrl(
  state: string,
  codeChallenge?: string,
): string {
  const { clientId, redirectUri } = requireSlackConfig();

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: SLACK_SCOPES,
    user_scope: SLACK_USER_SCOPES,
    state,
  });
  // Required by Slack for a redirect_uri that isn't a real HTTPS URL —
  // localhost during local dev counts as "non-web" in Slack's eyes (hit
  // live: "Must use PKCE to redirect to a non-web URI"). See
  // lib/integrations/pkce.ts.
  if (codeChallenge) {
    params.set("code_challenge", codeChallenge);
    params.set("code_challenge_method", "S256");
  }

  return `https://slack.com/oauth/v2/authorize?${params.toString()}`;
}

interface SlackOAuthResponse {
  ok: boolean;
  error?: string;
  access_token?: string;
  bot_user_id?: string;
  team?: { id: string; name: string };
  // Only present if the Slack app has opted into token rotation — not
  // enabled here, so these are never expected in practice, but the shape
  // is read defensively rather than assumed absent.
  expires_in?: number;
  // A separate credential from access_token above — Slack issues this only
  // when the request carried a user_scope (SLACK_USER_SCOPES). Optional: a
  // user can decline the user-scope consent independently of the bot
  // install, so this may be absent even on an otherwise-successful exchange.
  authed_user?: { id: string; access_token?: string };
}

export interface SlackTokens {
  botToken: string;
  botUserId: string;
  teamId: string;
  teamName: string;
  expiresAt: Date | null;
  // Null when the user didn't grant the user_scope permissions (e.g.
  // declined that half of the consent screen) — nothing currently reads
  // this token, it's stored for when a tool that needs it exists.
  userAccessToken: string | null;
  authedUserId: string | null;
}

export async function exchangeSlackCode(
  code: string,
  codeVerifier?: string,
): Promise<SlackTokens> {
  const { clientId, clientSecret, redirectUri } = requireSlackConfig();

  const body = new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
  });
  if (codeVerifier) {
    body.set("code_verifier", codeVerifier);
  }

  const response = await fetch("https://slack.com/api/oauth.v2.access", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  // Slack's Web API returns HTTP 200 even when the request failed — success
  // is signalled by the JSON `ok` field, not response.ok. Checking
  // response.ok here would silently treat every failure as a success with
  // undefined token fields.
  const data = (await response.json()) as SlackOAuthResponse;

  if (!data.ok || !data.access_token || !data.team || !data.bot_user_id) {
    throw new Error(
      `Slack token exchange failed: ${data.error ?? "unknown error"}`,
    );
  }

  return {
    botToken: data.access_token,
    botUserId: data.bot_user_id,
    teamId: data.team.id,
    teamName: data.team.name,
    expiresAt: data.expires_in
      ? new Date(Date.now() + data.expires_in * 1000)
      : null,
    userAccessToken: data.authed_user?.access_token ?? null,
    authedUserId: data.authed_user?.id ?? null,
  };
}

export const slackOAuthAdapter: OAuthAdapter = {
  provider: "slack",
  usesPkce: true,
  buildAuthUrl: buildSlackAuthUrl,
  async exchangeCode(code, codeVerifier) {
    const tokens = await exchangeSlackCode(code, codeVerifier);
    return {
      accountName: tokens.teamName,
      config: { teamId: tokens.teamId, teamName: tokens.teamName },
      credentials: {
        botToken: tokens.botToken,
        botUserId: tokens.botUserId,
        userAccessToken: tokens.userAccessToken,
        authedUserId: tokens.authedUserId,
      },
      expiresAt: tokens.expiresAt,
    };
  },
};
