import { z } from "zod";

import { cleanEmailBody } from "@/lib/integrations/shared/clean-email-body";
import { getValidOutlookAccessToken } from "@/lib/integrations/integration-service";
import {
  getOutlookMessage,
  listUnreadOutlookMessages,
} from "@/lib/integrations/outlook/client";
import { extractEmailDeterministically } from "@/lib/harness/pipeline-helpers";
import { ensureScopeAvailable } from "@/lib/mcp/tools/shared/ensure-scope-available";
import { translateScopeError } from "@/lib/mcp/tools/shared/translate-scope-error";
import { toolError, toolSuccess } from "@/lib/mcp/tool-result";

const inputSchema = {
  maxResults: z
    .number()
    .int()
    .min(1)
    .max(25)
    .default(10)
    .describe("How many unread messages to fetch, most recent first."),
};

const outputSchema = {
  messages: z.array(
    z.object({
      id: z.string(),
      from: z
        .string()
        .describe('Raw display header, e.g. "Jane Doe <jane@example.com>".'),
      senderEmail: z
        .string()
        .nullable()
        .describe(
          "The sender's address alone, for replying — null if it couldn't be parsed.",
        ),
      subject: z.string(),
      body: z.string(),
    }),
  ),
};

/**
 * Read-only inbox access for the connected Outlook account specifically —
 * same reasoning as GMAIL_READ_INBOX's own comment (never marks anything
 * read, only reads mail already scoped to this app via
 * OUTLOOK_INBOX_FOLDER, see outlook/client.ts).
 */
export function createOutlookReadInboxTool(
  organisationId: string,
  actionIntegrationId?: string | null,
) {
  return {
    name: "OUTLOOK_READ_INBOX",
    description:
      "List unread messages waiting in the connected Outlook inbox, with their full content — use this to see what's actually there before deciding what to do about it.",
    inputSchema,
    outputSchema,
    handler: async ({ maxResults }: { maxResults: number }) => {
      try {
        const scopeError = await ensureScopeAvailable(
          organisationId,
          "outlook",
          actionIntegrationId,
          "OUTLOOK_READ_INBOX",
        );
        if (scopeError) return toolError(scopeError);

        const accessToken = await getValidOutlookAccessToken(
          organisationId,
          actionIntegrationId,
        );

        const summaries = await listUnreadOutlookMessages(
          accessToken,
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
