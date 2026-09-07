import { randomBytes, timingSafeEqual } from "node:crypto";

import type { Prisma } from "@/lib/generated/prisma/client";
import * as integrationRepository from "@/lib/integrations/integration-repository";
import { refreshAccessToken as refreshGmailAccessToken } from "@/lib/integrations/gmail/oauth";
import type { GmailTokens } from "@/lib/integrations/gmail/oauth";
import { refreshAccessToken as refreshGoogleAccessToken } from "@/lib/integrations/google/oauth-core";
import { listExternalMcpTools } from "@/lib/integrations/mcp/external-client";
import {
  encodeRemoteToolName,
  type DiscoveredMcpTool,
} from "@/lib/integrations/mcp/tool-naming";
import { refreshAccessToken as refreshMicrosoftAccessToken } from "@/lib/integrations/microsoft/oauth-core";
import type { OAuthExchangeResult } from "@/lib/integrations/oauth-adapter";

// Refresh a little before actual expiry so a token never goes stale
// mid-request.
const EXPIRY_SAFETY_MARGIN_MS = 60_000;
const GMAIL_PROVIDER = "gmail";
const SLACK_PROVIDER = "slack";
const OUTLOOK_PROVIDER = "outlook";
const TEAMS_PROVIDER = "teams";
const OUTLOOK_CALENDAR_PROVIDER = "outlook-calendar";
const WEBHOOK_PROVIDER = "webhook";
const GOOGLE_DRIVE_PROVIDER = "google-drive";
const SHAREPOINT_PROVIDER = "sharepoint";
export const MCP_PROVIDER = "mcp";

interface AccessRefreshCredentials {
  accessToken: string;
  refreshToken: string;
}

// Gmail, Outlook, Teams and Outlook Calendar all store credentials in this
// exact shape — one parser, parametrized by the label used in the error
// message, instead of four near-identical copies.
function asAccessRefreshCredentials(
  credentials: Record<string, unknown> | null,
  providerLabel: string,
): AccessRefreshCredentials {
  if (
    !credentials ||
    typeof credentials.accessToken !== "string" ||
    typeof credentials.refreshToken !== "string"
  ) {
    throw new Error(
      `${providerLabel} integration is missing valid credentials — reconnect it from Settings.`,
    );
  }
  return {
    accessToken: credentials.accessToken,
    refreshToken: credentials.refreshToken,
  };
}

interface SlackCredentials {
  botToken: string;
}

function asSlackCredentials(
  credentials: Record<string, unknown> | null,
): SlackCredentials {
  if (!credentials || typeof credentials.botToken !== "string") {
    throw new Error(
      "Slack integration is missing valid credentials — reconnect it from Settings.",
    );
  }
  return { botToken: credentials.botToken };
}

// Every connected account, across every provider — the data behind the
// Settings "boxes" UI (lib/integrations/integration-registry.ts groups
// these by provider for display).
export function listIntegrations(organisationId: string) {
  return integrationRepository.findIntegrationsByOrganisation(organisationId);
}

export function listIntegrationsByProvider(
  organisationId: string,
  provider: string,
) {
  return integrationRepository.findIntegrationsByProvider(
    organisationId,
    provider,
  );
}

export function getIntegration(organisationId: string, integrationId: string) {
  return integrationRepository.findIntegrationById(
    organisationId,
    integrationId,
  );
}

export function disconnectIntegration(
  organisationId: string,
  integrationId: string,
) {
  return integrationRepository.deleteIntegration(organisationId, integrationId);
}

// "Remove this integration entirely" from Settings — every connected
// account of one provider, not just one. Reuses the same org-scoped
// disconnectIntegration per account rather than a bulk repository query,
// so a cross-org id can never slip through a separate, unaudited path.
export async function disconnectAllAccounts(
  organisationId: string,
  provider: string,
) {
  const accounts = await listIntegrationsByProvider(organisationId, provider);
  await Promise.all(
    accounts.map((account) =>
      disconnectIntegration(organisationId, account.id),
    ),
  );
}

/**
 * The generic upsert every OAuth provider's callback route
 * (app/api/integrations/[provider]/callback) funnels through — a thin
 * wrapper over upsertIntegration keyed on the adapter's own exchange
 * result shape (lib/integrations/oauth-adapter.ts), so a new OAuth
 * provider never needs its own connect* function here.
 */
export function connectOAuthAccount(
  organisationId: string,
  provider: string,
  result: OAuthExchangeResult,
) {
  return integrationRepository.upsertIntegration(
    organisationId,
    provider,
    result.accountName,
    {
      // OAuthExchangeResult.config is declared as Record<string, unknown>
      // (a generic interface, not Prisma-aware) but every adapter only
      // ever populates it with plain strings — genuinely JSON-safe, just
      // not provably so to Prisma.InputJsonValue's structural type.
      config: result.config as Prisma.InputJsonValue,
      credentials: result.credentials,
      expiresAt: result.expiresAt,
    },
  );
}

// Predates connectOAuthAccount (Gmail was the only OAuth provider at the
// time) — kept as its own function so existing callers/tests don't need to
// build a GmailTokens value into an OAuthExchangeResult shape by hand.
export function connectGmailAccount(
  organisationId: string,
  email: string,
  tokens: GmailTokens,
) {
  return connectOAuthAccount(organisationId, GMAIL_PROVIDER, {
    accountName: email,
    config: { email },
    credentials: {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
    },
    expiresAt: tokens.expiresAt,
  });
}

/**
 * "Default" = earliest-connected account of this provider for this
 * organisation. There's no concept yet of a workflow picking a specific
 * account by default — every org-wide action for a provider uses whichever
 * account was connected first, unless a caller pins a specific
 * integrationId (see getValidGmailAccessToken/getSlackBotToken). Correct by
 * construction for the common case (one account), a known limitation once
 * a business connects two and expects both to be used by default — flagged
 * here deliberately rather than silently papered over.
 */
export async function getDefaultIntegrationByProvider(
  organisationId: string,
  provider: string,
) {
  const integrations = await integrationRepository.findIntegrationsByProvider(
    organisationId,
    provider,
  );
  return integrations[0] ?? null;
}

export function getDefaultGmailIntegration(organisationId: string) {
  return getDefaultIntegrationByProvider(organisationId, GMAIL_PROVIDER);
}

export function getDefaultOutlookIntegration(organisationId: string) {
  return getDefaultIntegrationByProvider(organisationId, OUTLOOK_PROVIDER);
}

interface RefreshResult {
  accessToken: string;
  expiresAt: Date;
  // Set only by providers that may rotate the refresh token on refresh
  // (Outlook/Teams/Outlook Calendar, via Microsoft's shared refresh
  // endpoint) — Gmail's refresh never sets this, so the fallback below
  // always resolves to today's exact Gmail behavior.
  refreshToken?: string;
}

/**
 * The shared refresh-and-persist core behind every getValidXAccessToken
 * function below. Extracted once a second real refresh-needing provider
 * (Outlook) existed — Gmail was the only case for a while, and the
 * original comment here explicitly deferred generalizing "from a sample of
 * one real refresh case"; that bar is well past met now (Outlook, Teams,
 * and Outlook Calendar all need it too).
 */
async function getValidAccessToken(params: {
  organisationId: string;
  provider: string;
  integrationId?: string | null;
  parseCredentials: (
    credentials: Record<string, unknown> | null,
  ) => AccessRefreshCredentials;
  refresh: (refreshToken: string) => Promise<RefreshResult>;
  notConnectedMessage: string;
  wrongProviderMessage: string;
}): Promise<string> {
  const integration = params.integrationId
    ? await integrationRepository.findIntegrationById(
        params.organisationId,
        params.integrationId,
      )
    : await getDefaultIntegrationByProvider(
        params.organisationId,
        params.provider,
      );
  if (!integration) {
    throw new Error(params.notConnectedMessage);
  }
  if (integration.provider !== params.provider) {
    throw new Error(params.wrongProviderMessage);
  }
  const credentials = params.parseCredentials(integration.credentials);

  const expiresSoon =
    !integration.expiresAt ||
    integration.expiresAt.getTime() - Date.now() < EXPIRY_SAFETY_MARGIN_MS;
  if (!expiresSoon) {
    return credentials.accessToken;
  }

  const refreshed = await params.refresh(credentials.refreshToken);
  await integrationRepository.updateIntegrationCredentials(
    integration.id,
    {
      accessToken: refreshed.accessToken,
      refreshToken: refreshed.refreshToken ?? credentials.refreshToken,
    },
    refreshed.expiresAt,
  );
  return refreshed.accessToken;
}

/**
 * Returns a Gmail access token guaranteed valid for immediate use,
 * refreshing and persisting a new one first if the stored token is expired
 * or about to expire. Throws if Gmail isn't connected for this org.
 *
 * integrationId, when provided (an agent's actionIntegrationId), pins this
 * to that *specific* connected Gmail account instead of the org's default
 * — looked up via findIntegrationById, so it's still organisation-scoped
 * even though the id itself came from the agent record, not this call's
 * own arguments. Falls back to getDefaultGmailIntegration when omitted,
 * same behavior as before this parameter existed.
 */
export function getValidGmailAccessToken(
  organisationId: string,
  integrationId?: string | null,
): Promise<string> {
  return getValidAccessToken({
    organisationId,
    provider: GMAIL_PROVIDER,
    integrationId,
    parseCredentials: (c) => asAccessRefreshCredentials(c, "Gmail"),
    refresh: refreshGmailAccessToken,
    notConnectedMessage:
      "Gmail is not connected for this organisation. Connect it from Settings.",
    wrongProviderMessage: "The bound action account is not a Gmail account.",
  });
}

/** Same shape as getValidGmailAccessToken, for the Outlook Mail provider. */
export function getValidOutlookAccessToken(
  organisationId: string,
  integrationId?: string | null,
): Promise<string> {
  return getValidAccessToken({
    organisationId,
    provider: OUTLOOK_PROVIDER,
    integrationId,
    parseCredentials: (c) => asAccessRefreshCredentials(c, "Outlook"),
    refresh: refreshMicrosoftAccessToken,
    notConnectedMessage:
      "Outlook is not connected for this organisation. Connect it from Settings.",
    wrongProviderMessage: "The bound action account is not an Outlook account.",
  });
}

/** Same shape again, for the Teams provider. */
export function getValidTeamsAccessToken(
  organisationId: string,
  integrationId?: string | null,
): Promise<string> {
  return getValidAccessToken({
    organisationId,
    provider: TEAMS_PROVIDER,
    integrationId,
    parseCredentials: (c) => asAccessRefreshCredentials(c, "Teams"),
    refresh: refreshMicrosoftAccessToken,
    notConnectedMessage:
      "Teams is not connected for this organisation. Connect it from Settings.",
    wrongProviderMessage: "The bound action account is not a Teams account.",
  });
}

/** Same shape again, for the Outlook Calendar provider. */
export function getValidOutlookCalendarAccessToken(
  organisationId: string,
  integrationId?: string | null,
): Promise<string> {
  return getValidAccessToken({
    organisationId,
    provider: OUTLOOK_CALENDAR_PROVIDER,
    integrationId,
    parseCredentials: (c) => asAccessRefreshCredentials(c, "Outlook Calendar"),
    refresh: refreshMicrosoftAccessToken,
    notConnectedMessage:
      "Outlook Calendar is not connected for this organisation. Connect it from Settings.",
    wrongProviderMessage:
      "The bound action account is not an Outlook Calendar account.",
  });
}

/** Same shape again, for the Google Drive provider. */
export function getValidGoogleDriveAccessToken(
  organisationId: string,
  integrationId?: string | null,
): Promise<string> {
  return getValidAccessToken({
    organisationId,
    provider: GOOGLE_DRIVE_PROVIDER,
    integrationId,
    parseCredentials: (c) => asAccessRefreshCredentials(c, "Google Drive"),
    refresh: refreshGoogleAccessToken,
    notConnectedMessage:
      "Google Drive is not connected for this organisation. Connect it from Settings.",
    wrongProviderMessage:
      "The bound action account is not a Google Drive account.",
  });
}

/** Same shape again, for the SharePoint provider. */
export function getValidSharePointAccessToken(
  organisationId: string,
  integrationId?: string | null,
): Promise<string> {
  return getValidAccessToken({
    organisationId,
    provider: SHAREPOINT_PROVIDER,
    integrationId,
    parseCredentials: (c) => asAccessRefreshCredentials(c, "SharePoint"),
    refresh: refreshMicrosoftAccessToken,
    notConnectedMessage:
      "SharePoint is not connected for this organisation. Connect it from Settings.",
    wrongProviderMessage:
      "The bound action account is not a SharePoint account.",
  });
}

/**
 * The single earliest-connected email account across *both* email
 * providers (Gmail, Outlook) — there's only ever one "from" address for a
 * send, so unlike getConnectedEmailIntegrations below (which returns one
 * per provider), this picks exactly one. Earliest-connected, not
 * "Gmail always wins": a business that only ever uses Outlook shouldn't
 * have Gmail silently take priority the day they also connect it for an
 * unrelated reason.
 */
export async function getDefaultEmailIntegration(organisationId: string) {
  const [gmail, outlook] = await Promise.all([
    integrationRepository.findIntegrationsByProvider(
      organisationId,
      GMAIL_PROVIDER,
    ),
    integrationRepository.findIntegrationsByProvider(
      organisationId,
      OUTLOOK_PROVIDER,
    ),
  ]);
  return (
    [...gmail, ...outlook].sort(
      (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
    )[0] ?? null
  );
}

/**
 * Used by send_email: resolves whichever email provider is actually
 * connected (or pinned via integrationId) and returns a valid access token
 * for it, so the tool doesn't need to know in advance whether it's talking
 * to Gmail or Outlook.
 */
export async function getValidEmailAccessToken(
  organisationId: string,
  integrationId?: string | null,
): Promise<{ provider: "gmail" | "outlook"; accessToken: string }> {
  const integration = integrationId
    ? await integrationRepository.findIntegrationById(
        organisationId,
        integrationId,
      )
    : await getDefaultEmailIntegration(organisationId);
  if (!integration) {
    throw new Error(
      "No email account (Gmail or Outlook) is connected for this organisation. Connect one from Settings.",
    );
  }
  if (
    integration.provider !== GMAIL_PROVIDER &&
    integration.provider !== OUTLOOK_PROVIDER
  ) {
    throw new Error("The bound action account is not an email account.");
  }
  const accessToken =
    integration.provider === GMAIL_PROVIDER
      ? await getValidGmailAccessToken(organisationId, integration.id)
      : await getValidOutlookAccessToken(organisationId, integration.id);
  return {
    provider: integration.provider as "gmail" | "outlook",
    accessToken,
  };
}

/**
 * Used by checkInboxAction: one default account *per* connected email
 * provider (0–2 results), not every account of every provider — matches
 * the existing "default = earliest per provider" semantics rather than
 * expanding scope to "every account ever connected".
 */
export async function getConnectedEmailIntegrations(organisationId: string) {
  const [gmail, outlook] = await Promise.all([
    getDefaultGmailIntegration(organisationId),
    getDefaultOutlookIntegration(organisationId),
  ]);
  return [gmail, outlook].filter(
    (integration): integration is NonNullable<typeof integration> =>
      integration !== null,
  );
}

/**
 * Returns a Slack bot token for immediate use. Unlike getValidGmailAccessToken,
 * there's no refresh branch — Slack bot tokens don't expire in the standard
 * (non-token-rotation) OAuth flow this app uses, so once connected, a
 * token is valid until the business disconnects or revokes it. integrationId
 * pins to a specific connected workspace the same way as Gmail's version;
 * omitted, falls back to the organisation's default (earliest-connected)
 * Slack workspace.
 */
export async function getSlackBotToken(
  organisationId: string,
  integrationId?: string | null,
): Promise<string> {
  const integration = integrationId
    ? await integrationRepository.findIntegrationById(
        organisationId,
        integrationId,
      )
    : await getDefaultIntegrationByProvider(organisationId, SLACK_PROVIDER);
  if (!integration) {
    throw new Error(
      "Slack is not connected for this organisation. Connect it from Settings.",
    );
  }
  if (integration.provider !== SLACK_PROVIDER) {
    throw new Error("The bound action account is not a Slack account.");
  }
  return asSlackCredentials(integration.credentials).botToken;
}

/**
 * Creates a new webhook account and returns the plaintext secret exactly
 * once — every other read of this integration only ever sees the
 * encrypted form. The caller (the one-time confirmation UI) must show it
 * immediately and never persist or log it itself.
 */
export async function connectWebhookAccount(
  organisationId: string,
  name: string,
) {
  const secret = randomBytes(32).toString("hex");
  const integration = await integrationRepository.upsertIntegration(
    organisationId,
    WEBHOOK_PROVIDER,
    name,
    { config: {}, credentials: { secret } },
  );
  return { integration, secret };
}

/**
 * The entire authentication boundary for the inbound webhook endpoint,
 * which has no session — a timing side-channel on the secret comparison
 * here is a real vulnerability, not a theoretical one, hence
 * timingSafeEqual rather than `===`.
 */
export async function verifyWebhookSecret(
  integrationId: string,
  providedSecret: string,
): Promise<{ organisationId: string } | null> {
  const integration =
    await integrationRepository.findIntegrationByIdUnscoped(integrationId);
  if (!integration || integration.provider !== WEBHOOK_PROVIDER) {
    return null;
  }
  const storedSecret = integration.credentials?.secret;
  if (typeof storedSecret !== "string") {
    return null;
  }

  const stored = Buffer.from(storedSecret);
  const provided = Buffer.from(providedSecret);
  if (stored.length !== provided.length || !timingSafeEqual(stored, provided)) {
    return null;
  }
  return { organisationId: integration.organisationId };
}

/**
 * Validates via a live listTools() call before saving anything — a broken
 * URL or bad token fails here, at connect time, with a specific error,
 * never silently at first agent run.
 *
 * Also refuses to reuse an existing label. Unlike an OAuth provider (where
 * "same account name" genuinely means "the same account, safe to refresh
 * in place" — see connectOAuthAccount) or connectWebhookAccount (which
 * already guards this exact case at its own call site), `label` here is a
 * free-text string the user types with no external identity behind it.
 * Two different servers both labeled "Notion" would otherwise collapse
 * into upsertIntegration's same (organisationId, provider, name) row,
 * silently repointing every agent already granted a tool from the first
 * connection at a different remote endpoint and credential with zero
 * warning.
 */
export async function connectMcpServer(
  organisationId: string,
  input: { label: string; url: string; token: string },
) {
  const existing = await integrationRepository.findIntegrationsByProvider(
    organisationId,
    MCP_PROVIDER,
  );
  if (existing.some((integration) => integration.name === input.label)) {
    throw new Error(
      `A connection named "${input.label}" already exists — disconnect it first or use a different label.`,
    );
  }

  const tools = await listExternalMcpTools(input.url, input.token);
  return integrationRepository.upsertIntegration(
    organisationId,
    MCP_PROVIDER,
    input.label,
    {
      // DiscoveredMcpTool[] is genuinely JSON-safe (plain strings, a
      // nested plain object, a boolean-or-null) but not structurally
      // provable as Prisma.InputJsonValue — same situation as
      // connectOAuthAccount's config cast above.
      config: {
        url: input.url,
        tools,
        toolsRefreshedAt: new Date().toISOString(),
      } as unknown as Prisma.InputJsonValue,
      credentials: { token: input.token },
    },
  );
}

export async function refreshMcpServerTools(
  organisationId: string,
  integrationId: string,
): Promise<void> {
  const integration = await integrationRepository.findIntegrationById(
    organisationId,
    integrationId,
  );
  if (!integration || integration.provider !== MCP_PROVIDER) {
    throw new Error("MCP server connection not found");
  }
  const url = (integration.config as { url: string }).url;
  const token = integration.credentials?.token as string | undefined;
  if (!token) {
    throw new Error("This connection has no saved token");
  }
  const tools = await listExternalMcpTools(url, token);
  await integrationRepository.upsertIntegration(
    organisationId,
    MCP_PROVIDER,
    integration.name,
    {
      config: {
        url,
        tools,
        toolsRefreshedAt: new Date().toISOString(),
      } as unknown as Prisma.InputJsonValue,
      credentials: { token },
    },
  );
}

/**
 * The one place a discovered tool is looked up by (integrationId,
 * remoteToolName) — used by policy-engine.ts's approval-gate check and
 * agent-service.ts's grant validation alike, so both always agree on
 * exactly which tools genuinely exist for this organisation right now.
 * Scoped by organisationId at the repository layer — an id belonging to a
 * different organisation's connection can never match here.
 *
 * `remoteToolName` here is whatever `parseMcpToolName` returned — for most
 * tools that's the real remote name unchanged, but a very long remote name
 * gets truncated+hashed by `encodeRemoteToolName` when the full
 * `mcp__<id>__<name>` string would exceed the 64-character limit
 * Gemini/OpenAI enforce (see tool-naming.ts). Matching by re-encoding each
 * cached tool's real name the same way — rather than comparing raw
 * `tool.name` — is what keeps that case working end to end instead of
 * silently 404ing every long-named tool.
 */
export async function findMcpTool(
  organisationId: string,
  integrationId: string,
  remoteToolName: string,
): Promise<DiscoveredMcpTool | null> {
  const integration = await integrationRepository.findIntegrationById(
    organisationId,
    integrationId,
  );
  if (!integration || integration.provider !== MCP_PROVIDER) return null;
  const tools = (integration.config as { tools?: DiscoveredMcpTool[] }).tools;
  return (
    tools?.find(
      (tool) =>
        encodeRemoteToolName(integrationId, tool.name) === remoteToolName,
    ) ?? null
  );
}
