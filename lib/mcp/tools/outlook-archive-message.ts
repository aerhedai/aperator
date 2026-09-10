import { z } from "zod";

import { archiveOutlookMessage } from "@/lib/integrations/outlook/client";
import { getValidOutlookAccessToken } from "@/lib/integrations/integration-service";
import { ensureScopeAvailable } from "@/lib/mcp/tools/shared/ensure-scope-available";
import { translateScopeError } from "@/lib/mcp/tools/shared/translate-scope-error";
import { toolError, toolSuccess } from "@/lib/mcp/tool-result";

const inputSchema = {
  messageId: z
    .string()
    .min(1)
    .describe(
      "A message id, as returned by OUTLOOK_READ_INBOX/OUTLOOK_SEARCH_INBOX.",
    ),
};

const outputSchema = {
  archived: z.boolean(),
};

/**
 * Not approval-gated — same reasoning as GMAIL_ARCHIVE_MESSAGE: reversible,
 * no customer-visible effect. messageId only ever reaches an agent via a
 * tool already scoped to OUTLOOK_INBOX_FOLDER.
 */
export function createOutlookArchiveMessageTool(
  organisationId: string,
  actionIntegrationId?: string | null,
) {
  return {
    name: "OUTLOOK_ARCHIVE_MESSAGE",
    description:
      "Archive a message in the connected Outlook inbox — moves it to the Archive folder without deleting it.",
    inputSchema,
    outputSchema,
    handler: async ({ messageId }: { messageId: string }) => {
      try {
        const scopeError = await ensureScopeAvailable(
          organisationId,
          "outlook",
          actionIntegrationId,
          "OUTLOOK_ARCHIVE_MESSAGE",
        );
        if (scopeError) return toolError(scopeError);

        const accessToken = await getValidOutlookAccessToken(
          organisationId,
          actionIntegrationId,
        );
        await archiveOutlookMessage(accessToken, messageId);
        return toolSuccess({ archived: true });
      } catch (error) {
        return toolError(translateScopeError(error));
      }
    },
  };
}
