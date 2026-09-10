const SLACK_API_BASE = "https://slack.com/api";

interface SlackApiResponse {
  ok: boolean;
  error?: string;
}

// Slack's search/list/history/user-info endpoints all need a user token —
// a bot token can't call them regardless of its own scopes. GET with the
// token as a Bearer header (Slack supports this for both GET and POST on
// its modern API), same divergence from Gmail/Graph's REST conventions
// already noted on postSlackMessage: success is the JSON `ok` field, not
// response.ok.
async function slackUserGet<T extends SlackApiResponse>(
  userToken: string,
  path: string,
  params: Record<string, string>,
): Promise<T> {
  const url = `${SLACK_API_BASE}${path}?${new URLSearchParams(params).toString()}`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${userToken}` },
  });
  const data = (await response.json()) as T;
  if (!data.ok) {
    throw new Error(`Slack ${path} failed: ${data.error ?? "unknown error"}`);
  }
  return data;
}

export interface SlackSearchMatch {
  channel: string | null;
  user: string | null;
  text: string;
  permalink: string;
}

interface SlackSearchMessagesResponse extends SlackApiResponse {
  messages?: {
    matches: {
      text: string;
      permalink: string;
      user?: string;
      channel?: { name?: string };
    }[];
  };
}

export async function searchSlackMessages(
  userToken: string,
  query: string,
  maxResults = 10,
): Promise<SlackSearchMatch[]> {
  const data = await slackUserGet<SlackSearchMessagesResponse>(
    userToken,
    "/search.messages",
    { query, count: String(maxResults) },
  );
  return (data.messages?.matches ?? []).map((match) => ({
    channel: match.channel?.name ?? null,
    user: match.user ?? null,
    text: match.text,
    permalink: match.permalink,
  }));
}

export interface SlackChannelSummary {
  id: string;
  name: string;
}

interface SlackConversationsListResponse extends SlackApiResponse {
  channels?: { id: string; name: string }[];
}

export async function listSlackChannels(
  userToken: string,
  maxResults = 100,
): Promise<SlackChannelSummary[]> {
  const data = await slackUserGet<SlackConversationsListResponse>(
    userToken,
    "/conversations.list",
    { limit: String(maxResults), types: "public_channel,private_channel" },
  );
  return data.channels ?? [];
}

export interface SlackChannelMessage {
  user: string | null;
  text: string;
  ts: string;
}

interface SlackConversationsHistoryResponse extends SlackApiResponse {
  messages?: { user?: string; text: string; ts: string }[];
}

export async function readSlackChannelHistory(
  userToken: string,
  channel: string,
  maxResults = 20,
): Promise<SlackChannelMessage[]> {
  const data = await slackUserGet<SlackConversationsHistoryResponse>(
    userToken,
    "/conversations.history",
    { channel, limit: String(maxResults) },
  );
  return (data.messages ?? []).map((m) => ({
    user: m.user ?? null,
    text: m.text,
    ts: m.ts,
  }));
}

export interface SlackUserInfo {
  id: string;
  realName: string | null;
  email: string | null;
}

interface SlackUsersInfoResponse extends SlackApiResponse {
  user?: {
    id: string;
    real_name?: string;
    profile?: { email?: string };
  };
}

export async function getSlackUserInfo(
  userToken: string,
  userId: string,
): Promise<SlackUserInfo> {
  const data = await slackUserGet<SlackUsersInfoResponse>(
    userToken,
    "/users.info",
    { user: userId },
  );
  if (!data.user) {
    throw new Error(`Slack users.info returned no user for "${userId}".`);
  }
  return {
    id: data.user.id,
    realName: data.user.real_name ?? null,
    email: data.user.profile?.email ?? null,
  };
}

export async function postSlackMessage(
  botToken: string,
  params: { channel: string; text: string },
): Promise<void> {
  const response = await fetch(`${SLACK_API_BASE}/chat.postMessage`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${botToken}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(params),
  });
  // Same divergence from Gmail's client as the OAuth exchange: Slack
  // returns HTTP 200 even on failure, so success is the JSON `ok` field,
  // not response.ok.
  const data = (await response.json()) as SlackApiResponse;
  if (!data.ok) {
    throw new Error(
      `Slack chat.postMessage failed: ${data.error ?? "unknown error"}`,
    );
  }
}
