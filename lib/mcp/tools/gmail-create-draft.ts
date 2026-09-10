import { z } from "zod";

import { createGmailDraft } from "@/lib/integrations/gmail/client";
import { getValidGmailAccessToken } from "@/lib/integrations/integration-service";
import { ensureScopeAvailable } from "@/lib/mcp/tools/shared/ensure-scope-available";
import { translateScopeError } from "@/lib/mcp/tools/shared/translate-scope-error";
import { toolError, toolSuccess } from "@/lib/mcp/tool-result";

const inputSchema = {
  to: z.email(),
  subject: z.string().min(1),
  body: z.string().min(1),
};

const outputSchema = {
  draftId: z.string(),
};

/**
 * Not approval-gated, unlike GMAIL_SEND_EMAIL: a draft sends nothing —
 * it sits in the mailbox for a human to review and send themselves. Use
 * this when a reply needs a person's eyes before it goes out at all,
 * rather than GMAIL_SEND_EMAIL's proposed-then-approved flow.
 */
export function createGmailCreateDraftTool(
  organisationId: string,
  actionIntegrationId?: string | null,
) {
  return {
    name: "GMAIL_CREATE_DRAFT",
    description:
      "Create a draft in the connected Gmail account — never sent automatically, just saved for a human to review and send.",
    inputSchema,
    outputSchema,
    handler: async ({
      to,
      subject,
      body,
    }: {
      to: string;
      subject: string;
      body: string;
    }) => {
      try {
        const scopeError = await ensureScopeAvailable(
          organisationId,
          "gmail",
          actionIntegrationId,
          "GMAIL_CREATE_DRAFT",
        );
        if (scopeError) return toolError(scopeError);

        const accessToken = await getValidGmailAccessToken(
          organisationId,
          actionIntegrationId,
        );
        const draft = await createGmailDraft(accessToken, {
          to,
          subject,
          body,
        });
        return toolSuccess({ draftId: draft.id });
      } catch (error) {
        return toolError(translateScopeError(error));
      }
    },
  };
}
