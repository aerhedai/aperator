import { z } from "zod";

import {
  getOutlookMessage,
  searchOutlookMessages,
} from "@/lib/integrations/outlook/client";
import { getValidOutlookAccessToken } from "@/lib/integrations/integration-service";
import { extractEmailDeterministically } from "@/lib/harness/pipeline-helpers";
import { ensureScopeAvailable } from "@/lib/mcp/tools/shared/ensure-scope-available";
import { translateScopeError } from "@/lib/mcp/tools/shared/translate-scope-error";
import { toolError, toolSuccess } from "@/lib/mcp/tool-result";

const inputSchema = {
  query: z
    .string()
    .min(1)
    .describe(
      'Free-text search across sender, subject, and body — e.g. "invoice" or "jane@example.com".',
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
 * OUTLOOK_READ_INBOX only ever sees unread messages — this is the broader
 * counterpart, same relationship as GMAIL_SEARCH_INBOX to GMAIL_READ_INBOX.
 * Same OUTLOOK_INBOX_FOLDER boundary as every other Outlook read tool
 * (CLAUDE.md §14), enforced in outlook/client.ts.
 */
export function createOutlookSearchInboxTool(
  organisationId: string,
  actionIntegrationId?: string | null,
) {
  return {
    name: "OUTLOOK_SEARCH_INBOX",
    description:
      "Search the connected Outlook inbox by free text across sender, subject, and body — broader than OUTLOOK_READ_INBOX, which only ever lists unread messages.",
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
          "outlook",
          actionIntegrationId,
          "OUTLOOK_SEARCH_INBOX",
        );
        if (scopeError) return toolError(scopeError);

        const accessToken = await getValidOutlookAccessToken(
          organisationId,
          actionIntegrationId,
        );
        const summaries = await searchOutlookMessages(
          accessToken,
          query,
          maxResults,
        );
        const messages = await Promise.all(
          summaries.map(async (summary) => {
            const message = await getOutlookMessage(accessToken, summary.id);
            return {
              id: message.id,
              from: message.from,
              senderEmail: extractEmailDeterministically(message.from),
              subject: message.subject,
              body: message.body,
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
