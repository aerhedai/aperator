const GRAPH_ME_BASE = "https://graph.microsoft.com/v1.0/me";

// The deterministic scope boundary for inbox ingestion — same reasoning as
// Gmail's GMAIL_INBOX_LABEL (CLAUDE.md #14): only mail the business has
// routed here via a one-time Outlook rule that moves matching mail into
// this folder is ever read or processed. Outlook has no direct label
// equivalent; a folder is the closest analogue since Outlook rules move
// mail into folders as their primary automation mechanism.
export const OUTLOOK_INBOX_FOLDER = "Aperator";

async function graphFetch(
  accessToken: string,
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const response = await fetch(`${GRAPH_ME_BASE}${path}`, {
    ...init,
    headers: {
      ...init?.headers,
      Authorization: `Bearer ${accessToken}`,
    },
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `Microsoft Graph request to ${path} failed (${response.status}): ${body}`,
    );
  }
  return response;
}

// Resolved fresh on every call rather than cached — this is an on-demand
// action (CLAUDE.md #30, no background worker), not a hot path, and
// avoids a stale-id edge case if the business ever recreates the folder.
async function resolveInboxFolderId(accessToken: string): Promise<string> {
  const params = new URLSearchParams({
    $filter: `displayName eq '${OUTLOOK_INBOX_FOLDER}'`,
  });
  const response = await graphFetch(
    accessToken,
    `/mailFolders?${params.toString()}`,
  );
  const data = (await response.json()) as { value: { id: string }[] };
  const folder = data.value[0];
  if (!folder) {
    throw new Error(
      `No Outlook folder named "${OUTLOOK_INBOX_FOLDER}" was found — create it and a rule that moves matching mail into it (see Settings).`,
    );
  }
  return folder.id;
}

export interface OutlookMessageSummary {
  id: string;
}

export async function listUnreadOutlookMessages(
  accessToken: string,
  maxResults = 10,
): Promise<OutlookMessageSummary[]> {
  const folderId = await resolveInboxFolderId(accessToken);
  const params = new URLSearchParams({
    $filter: "isRead eq false",
    $select: "id",
    $top: String(maxResults),
  });
  const response = await graphFetch(
    accessToken,
    `/mailFolders/${folderId}/messages?${params.toString()}`,
  );
  const data = (await response.json()) as { value: OutlookMessageSummary[] };
  return data.value;
}

interface GraphMessage {
  id: string;
  from?: { emailAddress?: { name?: string; address?: string } };
  subject?: string;
  body?: { content?: string };
}

export interface OutlookMessage {
  id: string;
  from: string;
  subject: string;
  body: string;
}

export async function getOutlookMessage(
  accessToken: string,
  messageId: string,
): Promise<OutlookMessage> {
  const params = new URLSearchParams({ $select: "from,subject,body" });
  const response = await graphFetch(
    accessToken,
    `/messages/${messageId}?${params.toString()}`,
    // Graph returns HTML by default — plain text avoids needing an
    // HTML-stripping step, matching Gmail's plain-text extraction.
    { headers: { Prefer: 'outlook.body-content-type="text"' } },
  );
  const data = (await response.json()) as GraphMessage;

  const fromAddress = data.from?.emailAddress;
  return {
    id: data.id,
    // "Name <addr>" — matches Gmail's raw "From" header shape so this
    // reads consistently, even though extractEmailDeterministically is a
    // plain regex match and doesn't actually require this exact format.
    from: fromAddress?.address
      ? `${fromAddress.name ?? ""} <${fromAddress.address}>`
      : "",
    subject: data.subject ?? "",
    body: (data.body?.content ?? "").trim(),
  };
}

export interface OutlookAttachment {
  filename: string;
  mimeType: string;
  content: Buffer;
}

// Graph's fileAttachment shape includes contentBytes directly in the same
// call that lists them (unlike Gmail, which needs a second round trip per
// attachment) — fine for the typical email-attachment sizes this is built
// for; Graph omits contentBytes above ~150MB, which would need a separate
// $value download instead, not implemented here.
interface GraphAttachment {
  "@odata.type": string;
  name: string;
  contentType: string;
  contentBytes?: string;
}

export async function listOutlookAttachments(
  accessToken: string,
  messageId: string,
): Promise<OutlookAttachment[]> {
  const params = new URLSearchParams({
    $select: "name,contentType,contentBytes",
  });
  const response = await graphFetch(
    accessToken,
    `/messages/${messageId}/attachments?${params.toString()}`,
  );
  const data = (await response.json()) as { value: GraphAttachment[] };
  return data.value
    .filter(
      (a) =>
        a["@odata.type"] === "#microsoft.graph.fileAttachment" &&
        a.contentBytes,
    )
    .map((a) => ({
      filename: a.name,
      mimeType: a.contentType,
      content: Buffer.from(a.contentBytes as string, "base64"),
    }));
}

// Same OUTLOOK_INBOX_FOLDER boundary as listUnreadOutlookMessages
// (CLAUDE.md §14) — $search runs scoped to that folder's messages
// endpoint, never the whole mailbox, regardless of what query text an
// agent supplies.
export async function searchOutlookMessages(
  accessToken: string,
  query: string,
  maxResults = 10,
): Promise<OutlookMessageSummary[]> {
  const folderId = await resolveInboxFolderId(accessToken);
  const params = new URLSearchParams({
    $search: `"${query.replace(/"/g, '\\"')}"`,
    $select: "id",
    $top: String(maxResults),
  });
  const response = await graphFetch(
    accessToken,
    `/mailFolders/${folderId}/messages?${params.toString()}`,
  );
  const data = (await response.json()) as { value: OutlookMessageSummary[] };
  return data.value;
}

// Moves to Graph's well-known "archive" folder — reversible (move back),
// no customer-visible effect, so not approval-gated.
export async function archiveOutlookMessage(
  accessToken: string,
  messageId: string,
): Promise<void> {
  await graphFetch(accessToken, `/messages/${messageId}/move`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ destinationId: "archive" }),
  });
}

// POSTing to /messages (rather than /sendMail) creates the message as a
// draft — Graph never sends it until a separate explicit send call, which
// this app doesn't make on its behalf. Same "nothing customer-visible
// happens" reasoning as Gmail's createGmailDraft for why this isn't
// approval-gated the way OUTLOOK_SEND_EMAIL is.
export async function createOutlookDraft(
  accessToken: string,
  params: { to: string; subject: string; body: string },
): Promise<{ id: string }> {
  const response = await graphFetch(accessToken, "/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      subject: params.subject,
      body: { contentType: "Text", content: params.body },
      toRecipients: [{ emailAddress: { address: params.to } }],
    }),
  });
  const data = (await response.json()) as { id: string };
  return { id: data.id };
}

export interface OutlookContact {
  id: string;
  displayName: string;
  email: string | null;
}

interface GraphContact {
  id: string;
  displayName?: string;
  emailAddresses?: { address: string }[];
}

// $search across name and email in one call — Contacts.ReadWrite was
// requested for exactly this (currently unused, per the scope's own
// schema.prisma-adjacent comment in oauth.ts).
export async function findOutlookContacts(
  accessToken: string,
  query: string,
  maxResults = 10,
): Promise<OutlookContact[]> {
  const params = new URLSearchParams({
    $search: `"${query.replace(/"/g, '\\"')}"`,
    $top: String(maxResults),
  });
  const response = await graphFetch(
    accessToken,
    `/contacts?${params.toString()}`,
  );
  const data = (await response.json()) as { value: GraphContact[] };
  return data.value.map((c) => ({
    id: c.id,
    displayName: c.displayName ?? "",
    email: c.emailAddresses?.[0]?.address ?? null,
  }));
}

// Not approval-gated: a new contact is internal address-book data, never
// seen by anyone outside the business and trivially deleted if wrong.
export async function createOutlookContact(
  accessToken: string,
  params: { displayName: string; email: string },
): Promise<{ id: string }> {
  const response = await graphFetch(accessToken, "/contacts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      givenName: params.displayName,
      emailAddresses: [{ address: params.email, name: params.displayName }],
    }),
  });
  const data = (await response.json()) as { id: string };
  return { id: data.id };
}

export async function markOutlookMessageRead(
  accessToken: string,
  messageId: string,
): Promise<void> {
  await graphFetch(accessToken, `/messages/${messageId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ isRead: true }),
  });
}

export async function sendOutlookMessage(
  accessToken: string,
  params: {
    to: string;
    subject: string;
    body: string;
    attachments?: { filename: string; mimeType: string; content: Buffer }[];
  },
): Promise<void> {
  await graphFetch(accessToken, "/sendMail", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message: {
        subject: params.subject,
        body: { contentType: "Text", content: params.body },
        toRecipients: [{ emailAddress: { address: params.to } }],
        attachments: params.attachments?.map((attachment) => ({
          "@odata.type": "#microsoft.graph.fileAttachment",
          name: attachment.filename,
          contentType: attachment.mimeType,
          contentBytes: attachment.content.toString("base64"),
        })),
      },
    }),
  });
}
