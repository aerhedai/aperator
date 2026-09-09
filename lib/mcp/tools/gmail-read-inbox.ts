import { z } from "zod";

import { cleanEmailBody } from "@/lib/integrations/shared/clean-email-body";
import {
  getGmailMessage,
  listUnreadInboxMessages,
} from "@/lib/integrations/gmail/client";
import { getValidGmailAccessToken } from "@/lib/integrations/integration-service";
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
 * Read-only inbox access for the connected Gmail account specifically. The
 * only other thing that reads this inbox is the EMAIL trigger's own
 * automatic dispatch (checkInboxAction -> dispatchInboundMessage); this
 * gives an agent a way to look at what's actually there on its own
 * initiative (chat asking "check my inbox", or a LOOP agent deciding what
 * to do about several messages in one run).
 *
 * Deliberately never marks anything read — that's a real state change with
 * a real consequence (checkInboxAction's own automatic dispatch would never
 * see that message again), and this tool has no way to know whether
 * whatever's calling it actually finished handling a message. An agent that
 * wants "don't show me this again" achieves it by acting on the message
 * (replying, filing it, etc.), the same as any other tool call.
 *
 * Only ever reads mail already scoped to this app (GMAIL_INBOX_LABEL, see
 * gmail/client.ts) — the same boundary checkInboxAction respects, never the
 * business's whole mailbox (CLAUDE.md §14).
 */
export function createGmailReadInboxTool(
  organisationId: string,
  actionIntegrationId?: string | null,
) {
  return {
    name: "GMAIL_READ_INBOX",
    description:
      "List unread messages waiting in the connected Gmail inbox, with their full content — use this to see what's actually there before deciding what to do about it.",
    inputSchema,
    outputSchema,
    handler: async ({ maxResults }: { maxResults: number }) => {
      try {
        const scopeError = await ensureScopeAvailable(
          organisationId,
          "gmail",
          actionIntegrationId,
          "GMAIL_READ_INBOX",
        );
        if (scopeError) return toolError(scopeError);

        const accessToken = await getValidGmailAccessToken(
          organisationId,
          actionIntegrationId,
        );

        const summaries = await listUnreadInboxMessages(
          accessToken,
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
