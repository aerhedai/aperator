const GRAPH_BASE = "https://graph.microsoft.com/v1.0";

async function graphFetch(
  accessToken: string,
  path: string,
): Promise<Response> {
  const response = await fetch(`${GRAPH_BASE}${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `Microsoft Teams request to ${path} failed (${response.status}): ${body}`,
    );
  }
  return response;
}

export interface TeamsChannel {
  id: string;
  displayName: string;
}

export async function listTeamChannels(
  accessToken: string,
  teamId: string,
): Promise<TeamsChannel[]> {
  const response = await graphFetch(accessToken, `/teams/${teamId}/channels`);
  const data = (await response.json()) as { value: TeamsChannel[] };
  return data.value;
}

export interface TeamsChannelMessage {
  id: string;
  from: string | null;
  content: string;
  createdDateTime: string;
}

interface GraphChannelMessage {
  id: string;
  from?: { user?: { displayName?: string } };
  body?: { content?: string };
  createdDateTime: string;
}

// Graph's channel-messages content is HTML by default (there's no
// plain-text Prefer header for this endpoint the way Outlook mail has) —
// callers get raw HTML back and are responsible for treating it as such;
// stripping isn't done here since a summarizing agent can just as easily
// work from HTML, and stripping would lose formatting that sometimes
// carries meaning (e.g. a bulleted list).
export async function readTeamChannelMessages(
  accessToken: string,
  teamId: string,
  channelId: string,
  maxResults = 20,
): Promise<TeamsChannelMessage[]> {
  const params = new URLSearchParams({ $top: String(maxResults) });
  const response = await graphFetch(
    accessToken,
    `/teams/${teamId}/channels/${channelId}/messages?${params.toString()}`,
  );
  const data = (await response.json()) as { value: GraphChannelMessage[] };
  return data.value.map((m) => ({
    id: m.id,
    from: m.from?.user?.displayName ?? null,
    content: m.body?.content ?? "",
    createdDateTime: m.createdDateTime,
  }));
}

export async function sendTeamsChannelMessage(
  accessToken: string,
  params: { teamId: string; channelId: string; text: string },
): Promise<void> {
  const response = await fetch(
    `${GRAPH_BASE}/teams/${params.teamId}/channels/${params.channelId}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ body: { content: params.text } }),
    },
  );
  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `Microsoft Teams channel message request failed (${response.status}): ${body}`,
    );
  }
}
