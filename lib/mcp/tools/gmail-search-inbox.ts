import { z } from "zod";

import { cleanEmailBody } from "@/lib/integrations/shared/clean-email-body";
import {
  getGmailMessage,
  searchInboxMessages,
} from "@/lib/integrations/gmail/client";
import { getValidGmailAccessToken } from "@/lib/integrations/integration-service";
import { extractEmailDeterministically } from "@/lib/harness/pipeline-helpers";
import { ensureScopeAvailable } from "@/lib/mcp/tools/shared/ensure-scope-available";
import { translateScopeError } from "@/lib/mcp/tools/shared/translate-scope-error";
import { toolError, toolSuccess } from "@/lib/mcp/tool-result";

const inputSchema = {
  query: z
    .string()
    .min(1)
    .describe(
      'Gmail search syntax, e.g. "from:jane@example.com is:unread" or "subject:invoice older_than:7d". Not limited to unread — this is GMAIL_READ_INBOX\'s broader counterpart.',
    ),
  maxResults: z.number().int().min(1).max(25).default(10),
};

const outputSchema = {
  messages: z.array(
    z.object({
      id: z.string(),
      from: z.string(),
      senderEmail: z.string().nullable(),
      subject: z.string(),
      body: z.string(),
    }),
  ),
};

/**
 * GMAIL_READ_INBOX only ever sees unread messages — this is for anything
 * else: read messages, a specific sender, a date range, an attachment
 * filter. Same GMAIL_INBOX_LABEL boundary as every other Gmail read tool
 * (CLAUDE.md §14) — enforced in gmail/client.ts's searchInboxMessages, not
 * here, so it can never be bypassed by a query string.
 */
export function createGmailSearchInboxTool(
  organisationId: string,
  actionIntegrationId?: string | null,
) {
  return {
    name: "GMAIL_SEARCH_INBOX",
    description:
      "Search the connected Gmail inbox with Gmail's own query syntax (from:, subject:, is:unread, older_than:, has:attachment, ...) — broader than GMAIL_READ_INBOX, which only ever lists unread messages.",
    inputSchema,
    outputSchema,
    handler: async ({
      query,
      maxResults,
    }: {
      query: string;
      maxResults: number;
    }) => {
      try {
        const scopeError = await ensureScopeAvailable(
          organisationId,
          "gmail",
          actionIntegrationId,
          "GMAIL_SEARCH_INBOX",
        );
        if (scopeError) return toolError(scopeError);

        const accessToken = await getValidGmailAccessToken(
          organisationId,
          actionIntegrationId,
        );
        const summaries = await searchInboxMessages(
          accessToken,
          query,
          maxResults,
        );
        const messages = await Promise.all(
          summaries.map(async (summary) => {
            const message = await getGmailMessage(accessToken, summary.id);
            return {
              id: message.id,
              from: message.from,
              senderEmail: extractEmailDeterministically(message.from),
              subject: message.subject,
              body: cleanEmailBody(message.body),
            };
          }),
        );
        return toolSuccess({ messages });
      } catch (error) {
        return toolError(translateScopeError(error));
      }
    },
  };
}
