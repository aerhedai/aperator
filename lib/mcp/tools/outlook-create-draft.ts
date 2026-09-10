import { z } from "zod";

import { createOutlookDraft } from "@/lib/integrations/outlook/client";
import { getValidOutlookAccessToken } from "@/lib/integrations/integration-service";
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
 * Not approval-gated, unlike OUTLOOK_SEND_EMAIL — same reasoning as
 * GMAIL_CREATE_DRAFT: a draft sends nothing, it just waits for a human.
 */
export function createOutlookCreateDraftTool(
  organisationId: string,
  actionIntegrationId?: string | null,
) {
  return {
    name: "OUTLOOK_CREATE_DRAFT",
    description:
      "Create a draft in the connected Outlook account — never sent automatically, just saved for a human to review and send.",
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
          "outlook",
          actionIntegrationId,
          "OUTLOOK_CREATE_DRAFT",
        );
        if (scopeError) return toolError(scopeError);

        const accessToken = await getValidOutlookAccessToken(
          organisationId,
          actionIntegrationId,
        );
        const draft = await createOutlookDraft(accessToken, {
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
