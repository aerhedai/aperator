import { z } from "zod";

import {
  applyGmailLabel,
  resolveOrCreateLabel,
} from "@/lib/integrations/gmail/client";
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
  label: z
    .string()
    .min(1)
    .describe(
      'The label to apply, e.g. "Processed" or "Needs Follow-up" — created automatically if it doesn\'t already exist.',
    ),
};

const outputSchema = {
  applied: z.boolean(),
};

/**
 * Purely organizational metadata — reversible, no customer-visible effect
 * — so not approval-gated, same reasoning as GMAIL_ARCHIVE_MESSAGE.
 * Labels are find-or-create by name (resolveOrCreateLabel) so an agent
 * never has to know Gmail's internal label ids or that they exist at all.
 */
export function createGmailApplyLabelTool(
  organisationId: string,
  actionIntegrationId?: string | null,
) {
  return {
    name: "GMAIL_APPLY_LABEL",
    description:
      "Apply a label to a message in the connected Gmail inbox, creating the label if it doesn't already exist — e.g. to mark something as handled.",
    inputSchema,
    outputSchema,
    handler: async ({
      messageId,
      label,
    }: {
      messageId: string;
      label: string;
    }) => {
      try {
        const scopeError = await ensureScopeAvailable(
          organisationId,
          "gmail",
          actionIntegrationId,
          "GMAIL_APPLY_LABEL",
        );
        if (scopeError) return toolError(scopeError);

        const accessToken = await getValidGmailAccessToken(
          organisationId,
          actionIntegrationId,
        );
        const labelId = await resolveOrCreateLabel(accessToken, label);
        await applyGmailLabel(accessToken, messageId, labelId);
        return toolSuccess({ applied: true });
      } catch (error) {
        return toolError(translateScopeError(error));
      }
    },
  };
}
