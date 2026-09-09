import { z } from "zod";

import { cleanEmailBody } from "@/lib/integrations/gmail/clean-email-body";
import {
  getGmailMessage,
  listUnreadInboxMessages,
} from "@/lib/integrations/gmail/client";
import { getValidEmailAccessToken } from "@/lib/integrations/integration-service";
import {
  getOutlookMessage,
  listUnreadOutlookMessages,
} from "@/lib/integrations/outlook/client";
import { extractEmailDeterministically } from "@/lib/harness/pipeline-helpers";
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
 * Read-only inbox access — the counterpart send_email never had. Until
 * this existed, the only thing that ever read a connected mailbox was the
 * EMAIL trigger's own automatic dispatch (checkInboxAction ->
 * dispatchInboundMessage); an agent had no way to look at what's actually
 * in an inbox on its own initiative (chat asking "check my inbox", or a
 * LOOP agent deciding what to do about several messages in one run).
 *
 * Deliberately never marks anything read — that's a real state change
 * with a real consequence (checkInboxAction's own automatic dispatch would
 * never see that message again), and this tool has no way to know whether
 * whatever's calling it actually finished handling a message. An agent
 * that wants "don't show me this again" achieves it by acting on the
 * message (replying, filing it, etc.), the same as any other tool call.
 *
 * Same provider-agnostic, pinned-or-default account resolution as
 * send_email (getValidEmailAccessToken) — reading and sending share the
 * same one "the business's email account" concept, not two.
 *
 * Only ever reads mail already scoped to this app (GMAIL_INBOX_LABEL /
 * OUTLOOK_INBOX_FOLDER, both "Aperator" — see the client files) — the
 * same boundary checkInboxAction respects, never the business's whole
 * mailbox (CLAUDE.md #14).
 */
export function createReadInboxTool(
  organisationId: string,
  actionIntegrationId?: string | null,
) {
  return {
    name: "read_inbox",
    description:
      "List unread messages waiting in the business's connected email inbox, with their full content — use this to see what's actually there before deciding what to do about it.",
    inputSchema,
    outputSchema,
    handler: async ({ maxResults }: { maxResults: number }) => {
      try {
        const { provider, accessToken } = await getValidEmailAccessToken(
          organisationId,
          actionIntegrationId,
        );

        const summaries =
          provider === "gmail"
            ? await listUnreadInboxMessages(accessToken, maxResults)
            : await listUnreadOutlookMessages(accessToken, maxResults);

        const messages = await Promise.all(
          summaries.map(async (summary) => {
            const message =
              provider === "gmail"
                ? await getGmailMessage(accessToken, summary.id)
                : await getOutlookMessage(accessToken, summary.id);
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
        const message =
          error instanceof Error ? error.message : "Failed to read the inbox.";
        return toolError(message);
      }
    },
  };
}
