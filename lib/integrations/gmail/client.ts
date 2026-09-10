const GMAIL_API_BASE = "https://gmail.googleapis.com/gmail/v1/users/me";

// The deterministic scope boundary for inbox ingestion: only mail the
// business has already routed here (via a one-time Gmail filter on a
// dedicated address, e.g. quotes@company.com) is ever read or processed.
// Deliberately not scoped further by subject/keyword — within this label,
// the agent decides what each email is actually asking for. Without this
// boundary, "Check inbox" would scan the whole real inbox, which is what
// happened during Phase 9 live testing: it processed 10 unrelated personal
// emails (newsletters, security alerts) instead of just the one test quote
// request. See CLAUDE.md #14: scope/permission boundaries are deterministic
// application logic, not something left to the LLM's judgement.
export const GMAIL_INBOX_LABEL = "Aperator";

async function gmailFetch(
  accessToken: string,
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const response = await fetch(`${GMAIL_API_BASE}${path}`, {
    ...init,
    headers: {
      ...init?.headers,
      Authorization: `Bearer ${accessToken}`,
    },
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `Gmail API request to ${path} failed (${response.status}): ${body}`,
    );
  }
  return response;
}

export async function getGmailProfile(
  accessToken: string,
): Promise<{ emailAddress: string }> {
  const response = await gmailFetch(accessToken, "/profile");
  return response.json();
}

export interface GmailMessageSummary {
  id: string;
}

export async function listUnreadInboxMessages(
  accessToken: string,
  maxResults = 10,
): Promise<GmailMessageSummary[]> {
  const params = new URLSearchParams({
    q: `label:${GMAIL_INBOX_LABEL} is:unread`,
    maxResults: String(maxResults),
  });
  const response = await gmailFetch(
    accessToken,
    `/messages?${params.toString()}`,
  );
  const data = (await response.json()) as { messages?: GmailMessageSummary[] };
  return data.messages ?? [];
}

interface GmailPayloadPart {
  mimeType: string;
  filename?: string;
  body?: { data?: string; attachmentId?: string; size?: number };
  parts?: GmailPayloadPart[];
}

function decodeBase64Url(data: string): string {
  return Buffer.from(data, "base64url").toString("utf-8");
}

function extractPlainTextBody(payload: GmailPayloadPart): string {
  if (payload.mimeType === "text/plain" && payload.body?.data) {
    return decodeBase64Url(payload.body.data);
  }
  for (const part of payload.parts ?? []) {
    const text = extractPlainTextBody(part);
    if (text) return text;
  }
  return "";
}

export interface GmailAttachmentRef {
  filename: string;
  mimeType: string;
  attachmentId: string;
  size: number;
}

// A file part has both a non-empty filename and an attachmentId (its
// content isn't inlined — a second call is needed to fetch the bytes,
// unlike Outlook's attachments endpoint which includes them directly).
function collectAttachmentRefs(
  payload: GmailPayloadPart,
): GmailAttachmentRef[] {
  const refs: GmailAttachmentRef[] = [];
  if (payload.filename && payload.body?.attachmentId) {
    refs.push({
      filename: payload.filename,
      mimeType: payload.mimeType,
      attachmentId: payload.body.attachmentId,
      size: payload.body.size ?? 0,
    });
  }
  for (const part of payload.parts ?? []) {
    refs.push(...collectAttachmentRefs(part));
  }
  return refs;
}

function headerValue(
  headers: { name: string; value: string }[],
  name: string,
): string {
  return (
    headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ??
    ""
  );
}

export interface GmailMessage {
  id: string;
  from: string;
  subject: string;
  body: string;
  attachments: GmailAttachmentRef[];
}

export async function getGmailMessage(
  accessToken: string,
  messageId: string,
): Promise<GmailMessage> {
  const response = await gmailFetch(
    accessToken,
    `/messages/${messageId}?format=full`,
  );
  const data = (await response.json()) as {
    id: string;
    payload: GmailPayloadPart & { headers: { name: string; value: string }[] };
  };

  return {
    id: data.id,
    from: headerValue(data.payload.headers, "From"),
    subject: headerValue(data.payload.headers, "Subject"),
    body: extractPlainTextBody(data.payload).trim(),
    attachments: collectAttachmentRefs(data.payload),
  };
}

// A second call, deliberately not fetched eagerly alongside the message —
// most inbound messages have no attachments, and the ones that do may
// have several; fetching bytes only for the specific attachments a
// pipeline actually decides to keep avoids downloading content that's
// never used.
export async function getGmailAttachmentContent(
  accessToken: string,
  messageId: string,
  attachmentId: string,
): Promise<Buffer> {
  const response = await gmailFetch(
    accessToken,
    `/messages/${messageId}/attachments/${attachmentId}`,
  );
  const data = (await response.json()) as { data: string };
  return Buffer.from(data.data, "base64url");
}

// Same GMAIL_INBOX_LABEL boundary as listUnreadInboxMessages (CLAUDE.md
// §14) — the caller's own query is ANDed with the label restriction, never
// used on its own, so a search can never reach outside the mailbox this
// app is actually scoped to regardless of what query text an agent
// supplies.
export async function searchInboxMessages(
  accessToken: string,
  query: string,
  maxResults = 10,
): Promise<GmailMessageSummary[]> {
  const params = new URLSearchParams({
    q: `label:${GMAIL_INBOX_LABEL} ${query}`,
    maxResults: String(maxResults),
  });
  const response = await gmailFetch(
    accessToken,
    `/messages?${params.toString()}`,
  );
  const data = (await response.json()) as { messages?: GmailMessageSummary[] };
  return data.messages ?? [];
}

// Removing the INBOX label is Gmail's actual "archive" operation — the
// message still exists (findable by label/search), it just stops
// appearing in the inbox view. Reversible (re-adding INBOX un-archives
// it), which is why this isn't approval-gated the way a customer-visible
// action is.
export async function archiveGmailMessage(
  accessToken: string,
  messageId: string,
): Promise<void> {
  await gmailFetch(accessToken, `/messages/${messageId}/modify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ removeLabelIds: ["INBOX"] }),
  });
}

// A draft is never sent — it sits in the mailbox for a human to review and
// send themselves, or for GMAIL_SEND_EMAIL to be called separately once
// approved. This is why creating one doesn't need the same approval gate
// GMAIL_SEND_EMAIL does: nothing customer-visible happens until a human
// (or an already-gated tool call) acts on it.
export async function createGmailDraft(
  accessToken: string,
  params: { to: string; subject: string; body: string },
): Promise<{ id: string }> {
  const response = await gmailFetch(accessToken, "/drafts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message: { raw: encodeMimeMessage(params) },
    }),
  });
  const data = (await response.json()) as { id: string };
  return { id: data.id };
}

interface GmailLabel {
  id: string;
  name: string;
}

async function findLabel(
  accessToken: string,
  name: string,
): Promise<string | null> {
  const response = await gmailFetch(accessToken, "/labels");
  const data = (await response.json()) as { labels?: GmailLabel[] };
  return data.labels?.find((label) => label.name === name)?.id ?? null;
}

async function createLabel(accessToken: string, name: string): Promise<string> {
  const response = await gmailFetch(accessToken, "/labels", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name,
      labelListVisibility: "labelShow",
      messageListVisibility: "show",
    }),
  });
  const data = (await response.json()) as { id: string };
  return data.id;
}

// Same find-or-create semantics as Drive's resolveOrCreateFolder — a
// business names a label like "Needs Follow-up" without having to create
// it in Gmail's own UI first.
export async function resolveOrCreateLabel(
  accessToken: string,
  name: string,
): Promise<string> {
  const existing = await findLabel(accessToken, name);
  if (existing) return existing;
  return createLabel(accessToken, name);
}

export async function applyGmailLabel(
  accessToken: string,
  messageId: string,
  labelId: string,
): Promise<void> {
  await gmailFetch(accessToken, `/messages/${messageId}/modify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ addLabelIds: [labelId] }),
  });
}

export async function markGmailMessageRead(
  accessToken: string,
  messageId: string,
): Promise<void> {
  await gmailFetch(accessToken, `/messages/${messageId}/modify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ removeLabelIds: ["UNREAD"] }),
  });
}

function encodeMimeMessage(params: {
  to: string;
  subject: string;
  body: string;
  attachments?: { filename: string; mimeType: string; content: Buffer }[];
}): string {
  if (!params.attachments || params.attachments.length === 0) {
    const message = [
      `To: ${params.to}`,
      `Subject: ${params.subject}`,
      "Content-Type: text/plain; charset=utf-8",
      "",
      params.body,
    ].join("\r\n");
    return Buffer.from(message).toString("base64url");
  }

  const boundary = `aperator_${Date.now()}`;
  const lines = [
    `To: ${params.to}`,
    `Subject: ${params.subject}`,
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=utf-8",
    "",
    params.body,
    "",
  ];
  for (const attachment of params.attachments) {
    lines.push(
      `--${boundary}`,
      `Content-Type: ${attachment.mimeType}; name="${attachment.filename}"`,
      "Content-Transfer-Encoding: base64",
      `Content-Disposition: attachment; filename="${attachment.filename}"`,
      "",
      attachment.content.toString("base64"),
      "",
    );
  }
  lines.push(`--${boundary}--`);

  return Buffer.from(lines.join("\r\n")).toString("base64url");
}

export async function sendGmailMessage(
  accessToken: string,
  params: {
    to: string;
    subject: string;
    body: string;
    attachments?: { filename: string; mimeType: string; content: Buffer }[];
  },
): Promise<void> {
  await gmailFetch(accessToken, "/messages/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ raw: encodeMimeMessage(params) }),
  });
}
