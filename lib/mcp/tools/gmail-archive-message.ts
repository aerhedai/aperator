import { z } from "zod";

import { archiveGmailMessage } from "@/lib/integrations/gmail/client";
import { getValidGmailAccessToken } from "@/lib/integrations/integration-service";
import { ensureScopeAvailable } from "@/lib/mcp/tools/shared/ensure-scope-available";
import { translateScopeError } from "@/lib/mcp/tools/shared/translate-scope-error";
import { toolError, toolSuccess } from "@/lib/mcp/tool-result";

const inputSchema = {
  messageId: z
    .string()
    .min(1)
    .describe(
      "A message id, as returned by GMAIL_READ_INBOX/GMAIL_SEARCH_INBOX.",
    ),
};

const outputSchema = {
  archived: z.boolean(),
};

/**
 * Not approval-gated: archiving only removes a message from the inbox
 * view (Gmail's real "archive" semantics — the message still exists and
 * is still findable), it never deletes anything and is trivially
 * reversible, and it has no customer-visible effect. messageId only ever
 * reaches an agent via a tool already scoped to GMAIL_INBOX_LABEL
 * (GMAIL_READ_INBOX/GMAIL_SEARCH_INBOX), so this can't be used to act on
 * mail outside that boundary even though it takes no label argument
 * itself.
 */
export function createGmailArchiveMessageTool(
  organisationId: string,
  actionIntegrationId?: string | null,
) {
  return {
    name: "GMAIL_ARCHIVE_MESSAGE",
    description:
      "Archive a message in the connected Gmail inbox — removes it from the inbox view without deleting it.",
    inputSchema,
    outputSchema,
    handler: async ({ messageId }: { messageId: string }) => {
      try {
        const scopeError = await ensureScopeAvailable(
          organisationId,
          "gmail",
          actionIntegrationId,
          "GMAIL_ARCHIVE_MESSAGE",
        );
        if (scopeError) return toolError(scopeError);

        const accessToken = await getValidGmailAccessToken(
          organisationId,
          actionIntegrationId,
        );
        await archiveGmailMessage(accessToken, messageId);
        return toolSuccess({ archived: true });
      } catch (error) {
        return toolError(translateScopeError(error));
      }
    },
  };
}
